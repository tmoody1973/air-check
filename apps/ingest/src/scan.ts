import { join } from "node:path";
import { assembleEpisode, showDateFromTitle } from "@aircheck/core";
import type { BoxClient } from "./box.js";
import { buildEpisodes, type BoxFolder, type DriveDoc, type PaperDoc } from "./build.js";
import type { IngestConvex, SourceReport } from "./convex.js";
import { onDisk } from "./disk.js";
import { RATE_LIMITED, type DriveClient } from "./drive.js";
import type { DropboxClient } from "./dropbox.js";
import { AuthRefused, HttpError } from "./http.js";
import { readTokenFile, refusalKey } from "./tokens.js";

type SourceName = SourceReport["source"];
export interface SourceMemory {
  /** Refused credentials, by hash, with the provider's code: never tried again (R13). Lives as long as the process. */
  refused: Map<string, string>;
  /** The last status sent per source; a status is sent only when it changes. */
  reported: Map<SourceName, string>;
  /** R14: each source's last good read (Paper text included), standing in when a connected source fails a scan. */
  lastGood: { box?: Map<string, BoxFolder[]>; drive?: Map<string, DriveDoc[]>; paper?: Map<string, PaperDoc[]> };
  /** R14: the last scan read every connected source. Until it has (and from process start), nothing is drafted. */
  lastScanComplete: boolean;
}
export const newMemory = (): SourceMemory => ({ refused: new Map(), reported: new Map(), lastGood: {}, lastScanComplete: false });

/** R14: a source that is not connected (no token file, not configured): its column is missing for every show. */
const ABSENT = "absent" as const;
/** A read: the source's data, ABSENT, or null when a connected source failed this scan. */
type Read<T> = Map<string, T[]> | typeof ABSENT | null;

export interface ScanDeps {
  convex: IngestConvex; log: (line: string) => void; memory: SourceMemory;
  tokenDir: string; inboxDir: string; preparedDir: string;
  /** null: BOX_* not set. */
  box: { client: BoxClient; folderId: string } | null;
  /** null: the app's client id/secret are not set. Called with the token file's refresh token, once per scan. */
  google: ((refreshToken: string) => DriveClient) | null;
  dropbox: ((refreshToken: string) => DropboxClient) | null;
}

/** R3: 2026 dates only. */
const is2026 = (date: string) => date.startsWith("2026-");
const dated = (name: string) => {
  const d = showDateFromTitle(name);
  return d.ok && is2026(d.date) ? d.date : null;
};
const push = <T>(m: Map<string, T[]>, k: string, v: T) => void m.set(k, [...(m.get(k) ?? []), v]);
/**
 * One doc that can't be read (Drive export 403, a doc over 1 MB, a Dropbox metadata 400) is that doc's question, not a
 * failed source: only the token and list calls fail a source. 429 is retried in `call`; 401 is the access token, not
 * the doc, so it still fails the source; so does Drive's throttling 403 (M5), which says nothing about the doc.
 */
const docError = (e: unknown) =>
  e instanceof HttpError && e.message !== RATE_LIMITED && (e.message === "too_large" || (e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429));
const orUnread = <T, U>(p: Promise<T>, unread: U): Promise<T | U> => p.catch((e: unknown) => (docError(e) ? unread : Promise.reject(e)));

/** Hard Rule 8: a short code, never a message that could carry a URL or a token. */
const code = (e: unknown) => (e instanceof HttpError || e instanceof AuthRefused ? e.message : "network");

async function report(deps: ScanDeps, r: SourceReport): Promise<void> {
  const key = JSON.stringify(r);
  if (deps.memory.reported.get(r.source) === key) return;
  try {
    await deps.convex.sourceStatus(r);
    deps.memory.reported.set(r.source, key);
  } catch {
    deps.log(`ingest step=source_status source=${r.source} ok=false`);
  }
}

/**
 * Reads one source. A refused credential is remembered and reported as needs_reconnect (Settings and Episodes say
 * "Reconnect needed"); a provider that is merely down is skipped this scan with its status left alone.
 */
async function guarded<T>(deps: ScanDeps, source: SourceName, key: string | null, account: string | undefined, read: () => Promise<{ value: T; count: number }>): Promise<T | null> {
  const who = account ? { account } : {};
  const refused = key === null ? undefined : deps.memory.refused.get(key);
  if (refused) {
    await report(deps, { source, state: "needs_reconnect", ...who, lastError: refused });
    return null;
  }
  const t0 = Date.now();
  try {
    const { value, count } = await read();
    deps.log(`ingest step=scan source=${source} ok=true count=${count} ms=${Date.now() - t0}`);
    await report(deps, { source, state: "connected", ...who });
    return value;
  } catch (e) {
    deps.log(`ingest step=scan source=${source} ok=false error=${code(e)}`);
    if (e instanceof AuthRefused) {
      if (key !== null) deps.memory.refused.set(key, e.code);
      await report(deps, { source, state: "needs_reconnect", ...who, lastError: e.code });
    }
    return null;
  }
}

/** A Connect-button source's token file, or the status that explains why there is none (R13). */
async function tokenFor(deps: ScanDeps, source: "google" | "dropbox", configured: boolean) {
  if (!configured) return (await report(deps, { source, state: "not_connected", lastError: "not_configured" }), ABSENT);
  const t = await readTokenFile(join(deps.tokenDir, `${source}.json`));
  if (t.kind === "missing") return (await report(deps, { source, state: "not_connected", lastError: "no_token" }), ABSENT);
  // A half-written file is a connected source that failed (needs_reconnect), not a disconnected one.
  if (t.kind === "invalid") return (await report(deps, { source, state: "needs_reconnect", lastError: "invalid_token_file" }), null);
  // M4: connected, but the folder's owner is wrong (DEPLOY.md). A Reconnect would not fix it, so it is not needs_reconnect.
  if (t.kind === "unreadable") return (await report(deps, { source, state: "connected", lastError: "unreadable_token_file" }), null);
  return { ...t, key: refusalKey(source, t.refreshToken, t.connectedAt ?? null) };
}

async function readBox(deps: ScanDeps): Promise<Read<BoxFolder>> {
  if (!deps.box) {
    await report(deps, { source: "box", state: "not_connected", lastError: "not_configured" });
    return ABSENT;
  }
  const { client, folderId } = deps.box;
  // Box has no Reconnect button: the fix is an admin authorising the app, with the same credentials. So a refusal is
  // not remembered; it is tried again next scan (once an hour, not a loop) and needs no restart once fixed.
  return guarded(deps, "box", null, undefined, async () => {
    const byDate = new Map<string, BoxFolder[]>();
    for (const f of await client.items(folderId)) {
      const date = f.type === "folder" ? dated(f.name) : null;
      if (!date) continue; // older years, and folders with no date at all (nothing to attach them to)
      const files = (await client.items(f.id)).filter((x) => x.type === "file").map(({ id, name, size }) => ({ id, name, size }));
      push(byDate, date, { id: f.id, name: f.name, assembly: assembleEpisode(f.name, files) });
    }
    return { value: byDate, count: byDate.size };
  });
}

async function readDrive(deps: ScanDeps): Promise<Read<DriveDoc>> {
  const t = await tokenFor(deps, "google", !!deps.google);
  if (t === ABSENT || t === null) return t;
  return guarded(deps, "google", t.key, t.account, async () => {
    const drive = deps.google!(t.refreshToken);
    const byDate = new Map<string, DriveDoc[]>();
    for (const d of await drive.listDocs()) {
      const date = dated(d.name);
      if (date) push(byDate, date, { id: d.id, name: d.name, text: await orUnread(drive.exportText(d.id), null) });
    }
    return { value: byDate, count: byDate.size };
  });
}

async function readPaper(deps: ScanDeps): Promise<Read<PaperDoc>> {
  const t = await tokenFor(deps, "dropbox", !!deps.dropbox);
  if (t === ABSENT || t === null) return t;
  return guarded(deps, "dropbox", t.key, t.account, async () => {
    const dbx = deps.dropbox!(t.refreshToken);
    const byDate = new Map<string, PaperDoc[]>();
    // R3: .paper files named for a 2026 show that mention Rhythm Lab, anywhere in the Dropbox.
    for (const f of await dbx.listFiles()) {
      const date = /\.paper$/i.test(f.name) && /rhythm lab/i.test(f.name) ? dated(f.name) : null;
      if (date) push(byDate, date, { id: f.id, name: f.name, export: await orUnread(dbx.exportText(f.id), { kind: "unreadable" as const }) });
    }
    return { value: byDate, count: byDate.size };
  });
}

/**
 * One scan (hourly). Every source is read and its status reported (R14):
 * - not connected: that column is missing for every show; shows still store and can still be drafted (missing notes is
 *   a gap; missing audio or tracklist already blocks drafting in core);
 * - connected but failing this scan (down, refused, half-written token file): its last good read stands in, so stored
 *   facts are not overwritten with gaps, and nothing is drafted until a scan reads every connected source again.
 */
export async function runScan(deps: ScanDeps): Promise<void> {
  const t0 = Date.now();
  const mem = deps.memory.lastGood;
  const failed: SourceName[] = [];
  let uncached = false;
  let absent = false;
  const use = <T>(name: SourceName, key: keyof typeof mem, r: Read<T>): Map<string, T[]> => {
    if (r === ABSENT) {
      absent = true;
      delete mem[key];
      return new Map();
    }
    if (r) {
      (mem as Record<string, unknown>)[key] = r;
      return r;
    }
    failed.push(name);
    const prev = mem[key] as Map<string, T[]> | undefined;
    if (!prev) uncached = true;
    return prev ?? new Map();
  };
  const box = use("box", "box", await readBox(deps));
  const drive = use("google", "drive", await readDrive(deps));
  const paper = use("dropbox", "paper", await readPaper(deps));
  deps.memory.lastScanComplete = failed.length === 0;

  const [{ episodes: stored }, disk] = await Promise.all([deps.convex.list(), onDisk(deps.inboxDir, deps.preparedDir)]);
  let episodes = buildEpisodes({ box, drive, paper }, stored, disk.complete);
  // ponytail: a failed source with no earlier read in this process (just restarted) can't be merged column by column
  // (list never returns the notes text), so shows already stored keep all their facts until a good scan.
  if (uncached) {
    const known = new Set(stored.map((r) => r.showDate));
    episodes = episodes.filter((e) => !known.has(e.showDate));
  }
  let ok = 0;
  let questions = 0;
  for (const e of episodes) {
    questions += e.questions.length;
    try {
      await deps.convex.upsert(e);
      ok++;
    } catch {
      deps.log(`ingest date=${e.showDate} step=upsert ok=false`);
    }
  }
  const partial = failed.length ? ` failed=${failed.join("_")}` : "";
  deps.log(`ingest step=scan ok=${ok === episodes.length && !failed.length} stored=${ok} questions=${questions}${partial} ms=${Date.now() - t0}`);
  // I3/R18: only a scan that read all three sources knows a date is gone (a renamed or deleted doc). A not-connected
  // source blocks it too, or disconnecting Google would delete Drive-only rows and Tarik's answers on them.
  if (deps.memory.lastScanComplete && !absent) await prune(deps, episodes.map((e) => e.showDate));
}

async function prune(deps: ScanDeps, keep: string[]): Promise<void> {
  try {
    const r = await deps.convex.prune(keep);
    if (r.skipped) deps.log(`ingest step=prune skipped=true count=${r.skipped}`);
    else if (r.deleted) deps.log(`ingest step=prune ok=true deleted=${r.deleted}`);
  } catch {
    deps.log("ingest step=prune ok=false");
  }
}
