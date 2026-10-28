import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { AUDIO_CHANGED, AUDIO_MISSING, type PackageDraft, nextToPublish, toMixcloudFields, validateForUpload } from "@aircheck/core";
import type { MixcloudStatus, PublisherConvex, PublishResult, QueueItem } from "./convex.js";
import { timed, whoTag, type Who } from "./log.js";
import { editDescription, imageType, MAX_COVER_BYTES, readTokenFile, showEditUrl, uploadShow, type EditOutcome, type UploadOutcome } from "./mixcloud.js";
import type { StateBox } from "./state.js";
import { RECONNECT_ALERT } from "./telegram.js";

export type { PublishResult };

export interface PublishDeps {
  convex: PublisherConvex; log: (line: string) => void;
  tokenFile: string; preparedDir: string; state: StateBox;
  /** setMixcloud, deduplicated (statusReporter). */
  report: (status: MixcloudStatus) => Promise<void>;
  /** A Telegram message to Tarik. Never throws; a failure never blocks publishing. */
  alert: (text: string) => Promise<boolean>;
  /** Tests only: the fake Mixcloud's address, a quick clock, and an exit that does not end the test run. */
  uploadUrl?: string; uploadTimeoutMs?: number; sleep?: (ms: number) => Promise<void>; exit?: (code: number) => void;
}

/** What a single upload needs (the unlisted test CLI has only this). */
type UploadDeps = Pick<PublishDeps, "convex" | "log" | "preparedDir" | "uploadUrl" | "uploadTimeoutMs">;

const COVER_TIMEOUT_MS = 15_000;
/** Package ids become a file name, so only plain names pass. */
const SAFE_ID = /^[A-Za-z0-9][\w-]{0,99}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Waits between attempts at a result or unclaim write (5 attempts). The upload itself is never retried. */
const WRITE_BACKOFF_MS = [1000, 2000, 4000, 8000];
const notReady = (e: unknown) => (e as { data?: { code?: string } })?.data?.code === "NOT_READY" || /NOT_READY/.test(String(e));

/**
 * The write that ends a claim (result or unclaim), tried 5 times. NOT_READY means an earlier attempt landed and only
 * its answer was lost. If it still fails, exit: systemd restarts the service and reconcile turns the package
 * outcome_unknown, rather than it sitting in `publishing` (uncounted by the pacing) forever.
 */
async function settle(deps: PublishDeps, who: Who, step: string, write: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await timed(deps.log, who, step, write);
    } catch (e) {
      if (notReady(e)) return;
      const backoff = WRITE_BACKOFF_MS[attempt];
      if (backoff === undefined) break;
      await (deps.sleep ?? wait)(backoff);
    }
  }
  deps.log(`publish ${whoTag(who)} step=record ok=false ms=0`);
  (deps.exit ?? ((code: number) => process.exit(code)))(1);
}

/** Calls setMixcloud only when the status changes, so a pass every 30 s does not write Convex every 30 s. */
export function statusReporter(convex: Pick<PublisherConvex, "setMixcloud">): (s: MixcloudStatus) => Promise<void> {
  let last = "";
  return async (s) => {
    const key = JSON.stringify(s);
    if (key === last) return;
    await convex.setMixcloud(s);
    last = key;
  };
}

type Connection = { ok: true; accessToken: string; rejectKey: string; status: MixcloudStatus } | { ok: false; status: MixcloudStatus };

/**
 * What the token file says. A connection Mixcloud already refused is not tried again. It is remembered as a hash of
 * the key plus connectedAt, so a Reconnect in Settings (which always writes a new connectedAt) is tried even if
 * Mixcloud hands back the same key.
 */
async function connection(deps: Pick<PublishDeps, "tokenFile" | "state">): Promise<Connection> {
  const t = await readTokenFile(deps.tokenFile);
  if (t.kind === "missing") return { ok: false, status: { state: "not_connected", lastError: "no_token" } };
  if (t.kind === "invalid") return { ok: false, status: { state: "needs_reconnect", lastError: "invalid_token_file" } };
  const who = { ...(t.account !== undefined ? { account: t.account } : {}), ...(t.connectedAt !== undefined ? { connectedAt: t.connectedAt } : {}) };
  const rejectKey = sha256(JSON.stringify([t.accessToken, t.connectedAt ?? null]));
  if (deps.state.get().rejectedToken === rejectKey) return { ok: false, status: { state: "needs_reconnect", ...who, lastError: "invalid_token" } };
  return { ok: true, accessToken: t.accessToken, rejectKey, status: { state: "connected", ...who } };
}

/** R12: once, at process start, before the loop. Then the token file's state, so a stale status row is corrected. */
export async function startup(deps: PublishDeps): Promise<void> {
  await timed(deps.log, "-", "reconcile", () => deps.convex.reconcile());
  await deps.report((await connection(deps)).status);
}

/** The MP3 hash, streamed (never read whole). */
function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

/** A package problem: the package is claimed and recorded failed (nothing is sent), so a human can reopen it. */
type Fail = { error: string };
/** A passing or shared problem: nothing is claimed; it shows as Mixcloud's lastError and the next pass tries again. */
type Hold = { hold: "cover_unavailable" | "bad_cover" };
type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string };
type Checked = { mp3Path: string; fields: Record<string, string>; picture: Picture };

const BAD_COVER = "cover is not a usable image";
const isOk = (v: object) => !("error" in v) && !("hold" in v);

/** The MP3 on disk must be the one Tarik approved (Review Focus 2). Checked after the claim, just before sending. */
async function checkAudio(mp3Path: string, expected: string | undefined): Promise<object | Fail> {
  let actual: string;
  try {
    actual = await sha256File(mp3Path);
  } catch {
    return { error: AUDIO_MISSING };
  }
  return actual === expected ? {} : { error: AUDIO_CHANGED };
}

/**
 * I3: a network error, a timeout or a 5xx (from Convex or storage) is passing: hold and try again next pass. A cover
 * that arrives but is not a JPEG/PNG/WebP/GIF under 10 MB, or is gone from storage, is a problem with the cover.
 */
async function checkCover(convex: PublisherConvex, storageId: string): Promise<Picture | Fail | Hold> {
  let url: string;
  try {
    url = await convex.coverUrl(storageId);
  } catch (e) {
    return (e as { data?: { code?: string } })?.data?.code === "NOT_FOUND" ? { error: BAD_COVER } : { hold: "cover_unavailable" };
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    if (res.status >= 500 || res.status === 408 || res.status === 429) return { hold: "cover_unavailable" };
    if (!res.ok) return { error: BAD_COVER };
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { hold: "cover_unavailable" };
  }
  const type = imageType(bytes);
  return type && bytes.length <= MAX_COVER_BYTES ? { bytes, type } : { error: BAD_COVER };
}

function checkDraft(draft: PackageDraft, mp3Bytes: number, pictureBytes: number): { fields: Record<string, string> } | Fail {
  const problems = validateForUpload(draft, { mp3Bytes, pictureBytes });
  if (problems.length) return { error: problems.join("; ") };
  try {
    return { fields: toMixcloudFields(draft) }; // Hard Rule 11: artist and song only, never times
  } catch {
    return { error: "invalid tags" };
  }
}

/** Everything that can be checked before the claim (I3). Nothing here sends a byte to Mixcloud. */
async function precheck(deps: UploadDeps, p: QueueItem, storageId: string): Promise<Checked | Fail | Hold> {
  const id = p.packageId;
  if (!SAFE_ID.test(id)) return { error: "bad package id" };
  const mp3Path = join(deps.preparedDir, `${id}.mp3`);
  const picture = await timed(deps.log, id, "cover", () => checkCover(deps.convex, storageId), isOk);
  // A bad standard cover would fail every show that uses it: hold until it is replaced, never fail them all.
  if ("error" in picture && !p.draft.coverStorageId) return { hold: "bad_cover" };
  if (!isOk(picture)) return picture as Fail | Hold;
  const mp3Bytes = await stat(mp3Path).then((st) => st.size, () => null);
  if (mp3Bytes === null) return { error: AUDIO_MISSING };
  const draft = await timed(deps.log, id, "validate", async () => checkDraft(p.draft, mp3Bytes, (picture as Picture).bytes.length), isOk);
  if ("error" in draft) return draft;
  return { mp3Path, fields: draft.fields, picture: picture as Picture };
}

const send = (deps: UploadDeps, id: string, accessToken: string, ready: Checked, unlisted = false) =>
  timed(deps.log, id, "upload", () => uploadShow({ accessToken, ...ready, unlisted, uploadUrl: deps.uploadUrl, timeoutMs: deps.uploadTimeoutMs }), (o) => o.kind === "succeeded");

/** At most one upload per pass: the oldest approved show with a cover, unless today's 3 already went up. */
export async function publishPass(deps: PublishDeps): Promise<void> {
  const conn = await connection(deps);
  if (!conn.ok) return deps.report(conn.status);
  const { packages: queued, publishedToday } = await deps.convex.queue();
  // Hard Rule 9: demo packages never publish. Convex already filters them; the publisher checks again.
  const packages = queued.filter((p) => {
    if (p.draft.workspace === "real") return true;
    deps.log(`publish package=${p.packageId} step=skip_demo ok=false ms=0`);
    return false;
  });
  // R6: never upload coverless, and never claim a package that cannot go up.
  const covered = packages.filter((p) => p.coverStorageId);
  const status: MixcloudStatus = covered.length < packages.length ? { ...conn.status, lastError: "no_cover" } : conn.status;
  const next = nextToPublish(covered.map((p) => ({ packageId: p.packageId, showDate: p.showDate, approvedAt: p.decidedAt ?? "" })), publishedToday);
  const pkg = next && "packageId" in next ? covered.find((p) => p.packageId === next.packageId) : undefined;
  if (!pkg?.coverStorageId) return deps.report(status);
  const id = pkg.packageId;

  // I3: the cover and the fields are checked before the claim, so a passing outage never fails a package.
  let ready: Checked | Fail | Hold;
  try {
    ready = await precheck(deps, pkg, pkg.coverStorageId);
  } catch {
    ready = { error: "internal_error" };
  }
  if ("hold" in ready) return deps.report({ ...status, lastError: ready.hold });

  try {
    await timed(deps.log, id, "claim", () => deps.convex.claim(id));
  } catch (e) {
    // M3: an answer lost on the way back means the claim may or may not have landed. Never upload on an unknown
    // claim. Undo it instead: nothing was sent, so approved is the truth, and unclaim's NOT_READY (the claim never
    // landed) counts as done. A NOT_READY claim was refused outright, so there is nothing to undo.
    if (!notReady(e)) await settle(deps, id, "unclaim", () => deps.convex.unclaim(id));
    return deps.report(status);
  }
  // From here on every path ends in one settled write (result or unclaim), whatever throws.
  if (!isOk(ready)) return settle(deps, id, "result", () => deps.convex.result(id, { status: "failed", error: (ready as Fail).error }));
  const checked = ready as Checked;
  let sent = false;
  let out: UploadOutcome;
  try {
    const audio = await timed(deps.log, id, "hash", () => checkAudio(checked.mp3Path, pkg.draft.audio.mp3Sha256), isOk);
    if ("error" in audio) return await settle(deps, id, "result", () => deps.convex.result(id, { status: "failed", error: (audio as Fail).error }));
    sent = true;
    out = await send(deps, id, conn.accessToken, checked);
    if (out.kind === "rate_limited") {
      // A rate limit proves Mixcloud did not take the show: wait as asked, then the one and only retry.
      await (deps.sleep ?? wait)(out.retryAfterSec * 1000);
      out = await send(deps, id, conn.accessToken, checked);
      if (out.kind === "rate_limited") out = { kind: "failed", code: "rate_limited" };
    }
  } catch {
    // Before the request: nothing was sent. After it started: the show may be up, so never retried.
    out = sent ? { kind: "unknown" } : { kind: "failed", code: "internal_error" };
  }

  if (out.kind === "invalid_token") {
    // Mixcloud checks the key before it takes audio, so nothing was posted: remember this connection (as a hash) so
    // it is never tried again, put the package back in the queue, say so once. The alert goes before the Convex
    // calls, so Tarik hears even if Convex is down too. Failing to save the hash costs one retry after a restart.
    await deps.state.update((s) => ({ ...s, rejectedToken: conn.rejectKey })).catch(() => deps.log(`publish package=${id} step=state ok=false ms=0`));
    await timed(deps.log, id, "alert", () => deps.alert(RECONNECT_ALERT), (ok) => ok).catch(() => false);
    await settle(deps, id, "unclaim", () => deps.convex.unclaim(id));
    return deps.report({ ...conn.status, state: "needs_reconnect", lastError: "invalid_token" });
  }
  const result: PublishResult =
    out.kind === "succeeded" ? { status: "succeeded", url: out.url }
    : out.kind === "failed" ? { status: "failed", error: out.code }
    : { status: "outcome_unknown" }; // never retried (Review Focus 1)
  await settle(deps, id, "result", () => deps.convex.result(id, result));
  await deps.report(out.kind === "failed" && out.code === "rate_limited" ? { ...status, lastError: "rate_limited" } : status);
}

/**
 * Plan 5c Task 4: at most one approved description update per pass, pushed with Mixcloud's edit endpoint. Hard Rule 1:
 * Convex hands out only updates a signed-in human approved. Not paced: an edit is not a new show (3-a-day is uploads).
 */
export async function updatePass(deps: PublishDeps): Promise<void> {
  const conn = await connection(deps);
  if (!conn.ok) return; // publishPass reports the token file's state; a refused key is never tried again
  // Not timed: an empty claim every 30 s would be a log line every 30 s. A throw reaches main's `step=pass` line.
  const u = await deps.convex.claimUpdate();
  if (!u) return;
  const who = { update: u.id, package: u.packageId };
  // Review Focus 3: the show to edit comes only from the package's own receipt; anything odd sends nothing.
  const editUrl = showEditUrl(u.showUrl, deps.uploadUrl);
  let out: EditOutcome;
  try {
    out = editUrl
      ? await timed(deps.log, who, "edit", () => editDescription({ accessToken: conn.accessToken, editUrl, description: u.description, timeoutMs: deps.uploadTimeoutMs }), (o) => o.kind === "pushed")
      : { kind: "failed", code: "bad_show_url" };
  } catch {
    out = { kind: "retry" }; // idempotent: trying again is safe
  }
  if (out.kind === "invalid_token") {
    // Same as an upload: remember the refused key, say so once, give the update back (nothing was changed).
    await deps.state.update((s) => ({ ...s, rejectedToken: conn.rejectKey })).catch(() => deps.log(`publish ${whoTag(who)} step=state ok=false ms=0`));
    await timed(deps.log, who, "alert", () => deps.alert(RECONNECT_ALERT), (ok) => ok).catch(() => false);
    await settle(deps, who, "update_record", () => deps.convex.recordUpdate(u.id, { status: "unclaim" }));
    return deps.report({ ...conn.status, state: "needs_reconnect", lastError: "invalid_token" });
  }
  const outcome = out.kind === "pushed" ? { status: "pushed" as const } : out.kind === "failed" ? { status: "failed" as const, error: out.code } : { status: "retry" as const };
  await settle(deps, who, "update_record", () => deps.convex.recordUpdate(u.id, outcome));
}

/** One loop tick: the publish step, then the update step, which runs even if the publish step throws (single-flight). */
export async function fullPass(deps: PublishDeps): Promise<void> {
  try {
    await publishPass(deps);
  } finally {
    await updatePass(deps);
  }
}

/**
 * R8, Task 7's spike: upload one approved package unlisted, by hand over ssh with the service stopped. Reads only
 * the approved queue, uploads once, and never calls claim, result, unclaim, reconcile or setMixcloud.
 * Returns the show's URL or a short error code; that is all the CLI prints.
 */
export async function unlistedTest(deps: UploadDeps & Pick<PublishDeps, "tokenFile">, packageId: string): Promise<string> {
  const pkg = (await deps.convex.queue()).packages.find((p) => p.packageId === packageId);
  if (!pkg) return "not_in_queue";
  if (pkg.draft.workspace !== "real") return "demo_cannot_publish"; // Hard Rule 9: this path never meets the gate
  if (!pkg.coverStorageId) return "no_cover";
  const t = await readTokenFile(deps.tokenFile);
  if (t.kind !== "ok") return t.kind === "missing" ? "no_token" : "invalid_token_file";
  const ready = await precheck(deps, pkg, pkg.coverStorageId);
  if ("hold" in ready) return ready.hold;
  if ("error" in ready) return ready.error;
  const audio = await checkAudio(ready.mp3Path, pkg.draft.audio.mp3Sha256);
  if ("error" in audio) return (audio as Fail).error;
  const out = await send(deps, packageId, t.accessToken, ready, true);
  return out.kind === "succeeded" ? out.url : out.kind === "failed" ? out.code : out.kind;
}
