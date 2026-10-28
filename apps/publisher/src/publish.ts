import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { type PackageDraft, nextToPublish, toMixcloudFields, validateForUpload } from "@aircheck/core";
import type { MixcloudStatus, PublisherConvex, PublishResult, QueueItem } from "./convex.js";
import { timed } from "./log.js";
import { imageType, MAX_COVER_BYTES, readTokenFile, uploadShow, type UploadOutcome } from "./mixcloud.js";
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
  /** Tests only: the fake Mixcloud's address and a quick clock. */
  uploadUrl?: string; uploadTimeoutMs?: number; sleep?: (ms: number) => Promise<void>;
}

/** What a single upload needs (the unlisted test CLI has only this). */
type UploadDeps = Pick<PublishDeps, "convex" | "log" | "preparedDir" | "uploadUrl" | "uploadTimeoutMs">;

const COVER_TIMEOUT_MS = 15_000;
/** Package ids become a file name, so only plain names pass. */
const SAFE_ID = /^[A-Za-z0-9][\w-]{0,99}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

type Fail = { error: string };
type Prepared = { mp3Path: string; fields: Record<string, string>; picture: { bytes: Uint8Array<ArrayBuffer>; type: string } };

async function checkAudio(mp3Path: string, expected: string | undefined): Promise<{ mp3Bytes: number } | Fail> {
  let mp3Bytes: number;
  let actual: string;
  try {
    mp3Bytes = (await stat(mp3Path)).size;
    actual = await sha256File(mp3Path);
  } catch {
    return { error: "audio file missing" };
  }
  return actual === expected ? { mp3Bytes } : { error: "audio changed since approval" };
}

async function checkCover(convex: PublisherConvex, storageId: string): Promise<Prepared["picture"] | Fail> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const res = await fetch(await convex.coverUrl(storageId), { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    if (!res.ok) return { error: "cover download failed" };
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { error: "cover download failed" };
  }
  const type = imageType(bytes);
  return type && bytes.length <= MAX_COVER_BYTES ? { bytes, type } : { error: "cover is not a usable image" };
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

/** Everything that can go wrong before a byte goes to Mixcloud. A Fail here means nothing was sent. */
async function prepare(deps: UploadDeps, p: QueueItem, storageId: string): Promise<Prepared | Fail> {
  const id = p.packageId;
  if (!SAFE_ID.test(id)) return { error: "bad package id" };
  const mp3Path = join(deps.preparedDir, `${id}.mp3`);
  const isOk = (v: object) => !("error" in v);
  const audio = await timed(deps.log, id, "hash", () => checkAudio(mp3Path, p.draft.audio.mp3Sha256), isOk);
  if ("error" in audio) return audio;
  const picture = await timed(deps.log, id, "cover", () => checkCover(deps.convex, storageId), isOk);
  if ("error" in picture) return picture;
  const draft = await timed(deps.log, id, "validate", async () => checkDraft(p.draft, audio.mp3Bytes, picture.bytes.length), isOk);
  if ("error" in draft) return draft;
  return { mp3Path, fields: draft.fields, picture };
}

const send = (deps: UploadDeps, id: string, accessToken: string, ready: Prepared, unlisted = false) =>
  timed(deps.log, id, "upload", () => uploadShow({ accessToken, ...ready, unlisted, uploadUrl: deps.uploadUrl, timeoutMs: deps.uploadTimeoutMs }), (o) => o.kind === "succeeded");

/** At most one upload per pass: the oldest approved show with a cover, unless today's 3 already went up. */
export async function publishPass(deps: PublishDeps): Promise<void> {
  const conn = await connection(deps);
  if (!conn.ok) return deps.report(conn.status);
  const { packages, publishedToday } = await deps.convex.queue();
  // R6: never upload coverless, and never claim a package that cannot go up.
  const covered = packages.filter((p) => p.coverStorageId);
  const status: MixcloudStatus = covered.length < packages.length ? { ...conn.status, lastError: "no_cover" } : conn.status;
  const next = nextToPublish(covered.map((p) => ({ packageId: p.packageId, showDate: p.showDate, approvedAt: p.decidedAt ?? "" })), publishedToday);
  const pkg = next && "packageId" in next ? covered.find((p) => p.packageId === next.packageId) : undefined;
  if (!pkg?.coverStorageId) return deps.report(status);
  const id = pkg.packageId;

  await timed(deps.log, id, "claim", () => deps.convex.claim(id));
  const record = (r: PublishResult) => timed(deps.log, id, "result", () => deps.convex.result(id, r));
  const ready = await prepare(deps, pkg, pkg.coverStorageId);
  if ("error" in ready) return record({ status: "failed", error: ready.error });

  let out: UploadOutcome = await send(deps, id, conn.accessToken, ready);
  if (out.kind === "rate_limited") {
    // A rate limit proves Mixcloud did not take the show: wait as asked, then the one and only retry.
    await (deps.sleep ?? wait)(out.retryAfterSec * 1000);
    out = await send(deps, id, conn.accessToken, ready);
    if (out.kind === "rate_limited") out = { kind: "failed", code: "rate_limited" };
  }

  if (out.kind === "invalid_token") {
    // Mixcloud checks the key before it takes audio, so nothing was posted: remember this connection (as a hash) so
    // it is never tried again, put the package back in the queue, say so once. The alert goes before the Convex
    // calls, so Tarik hears even if Convex is down too.
    await deps.state.update((s) => ({ ...s, rejectedToken: conn.rejectKey }));
    await timed(deps.log, id, "alert", () => deps.alert(RECONNECT_ALERT), (sent) => sent).catch(() => false);
    await timed(deps.log, id, "unclaim", () => deps.convex.unclaim(id));
    return deps.report({ ...conn.status, state: "needs_reconnect", lastError: "invalid_token" });
  }
  if (out.kind === "succeeded") await record({ status: "succeeded", url: out.url });
  else if (out.kind === "failed") await record({ status: "failed", error: out.code });
  else await record({ status: "outcome_unknown" }); // never retried (Review Focus 1)
  await deps.report(out.kind === "failed" && out.code === "rate_limited" ? { ...status, lastError: "rate_limited" } : status);
}

/**
 * R8, Task 7's spike: upload one approved package unlisted, by hand over ssh with the service stopped. Reads only
 * the approved queue, uploads once, and never calls claim, result, unclaim, reconcile or setMixcloud.
 * Returns the show's URL or a short error code; that is all the CLI prints.
 */
export async function unlistedTest(deps: UploadDeps & Pick<PublishDeps, "tokenFile">, packageId: string): Promise<string> {
  const pkg = (await deps.convex.queue()).packages.find((p) => p.packageId === packageId);
  if (!pkg) return "not_in_queue";
  if (!pkg.coverStorageId) return "no_cover";
  const t = await readTokenFile(deps.tokenFile);
  if (t.kind !== "ok") return t.kind === "missing" ? "no_token" : "invalid_token_file";
  const ready = await prepare(deps, pkg, pkg.coverStorageId);
  if ("error" in ready) return ready.error;
  const out = await send(deps, packageId, t.accessToken, ready, true);
  return out.kind === "succeeded" ? out.url : out.kind === "failed" ? out.code : out.kind;
}
