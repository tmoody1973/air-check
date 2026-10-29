import { join } from "node:path";
import { assembleEpisode, showDateFromTitle } from "@aircheck/core";
import type { BoxClient } from "./box.js";
import { buildEpisodes, type BoxFolder, type DriveDoc, type PaperDoc } from "./build.js";
import type { IngestConvex, Placement, SourceReport, Unplaced } from "./convex.js";
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
  /** Plan 6b: one gate for the hourly timer and the minute pass's rescan, so two scans never run at once. */
  scanning: boolean;
  /**
   * R5: the `rescanAfter` the last scan read with its corrections and placements (Convex's clock only). A newer one is
   * a save that scan never saw: the minute pass rescans, and nothing is drafted until it has. 0 before the first.
   */
  seenRescanAfter: number;
}
export const newMemory = (): SourceMemory => ({ refused: new Map(), reported: new Map(), lastGood: {}, lastScanComplete: false, scanning: false, seenRescanAfter: 0 });

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

/** One scan's placements and added 2025 dates in, and the names it could not date out. */
export interface Names { placements: Placement[]; unplaced: Unplaced[]; extraDates?: ReadonlySet<string> }
const MAX_UNPLACED = 50;
const NO_DATE = "No date found in the title.";

/** R3: 2026 dates, plus the 2025 Fridays Tarik added on Episodes (so nothing already posted is drafted again). */
const inScope = (date: string, names: Names) => date.startsWith("2026-") || !!names.extraDates?.has(date);
/**
 * A doc's or folder's show date: Tarik's placement first, then its name. A name with something date-like the rules
 * refuse is listed in `names.unplaced` (at most 50); one with no date at all (old one-offs) or an older year is not.
 */
export function dated(source: Placement["source"], name: string, id: string, names: Names): string | null {
  const placed = names.placements.find((p) => p.source === source && p.id === id);
  if (placed && inScope(placed.date, names)) return placed.date;
  const d = showDateFromTitle(name);
  if (d.ok) return inScope(d.date, names) ? d.date : null;
  if (d.reason !== NO_DATE && names.unplaced.length < MAX_UNPLACED) names.unplaced.push({ source, id, name, reason: d.reason });
  return null;
}
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

export async function readBox(deps: ScanDeps, names: Names): Promise<Read<BoxFolder>> {
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
      const date = f.type === "folder" ? dated("box", f.name, f.id, names) : null;
      if (!date) continue; // older years, and folders with no date at all (nothing to attach them to)
      const files = (await client.items(f.id)).filter((x) => x.type === "file").map(({ id, name, size }) => ({ id, name, size }));
      push(byDate, date, { id: f.id, name: f.name, assembly: assembleEpisode(f.name, files), wavs: files.filter((x) => /\.wav$/i.test(x.name)) });
    }
    return { value: byDate, count: byDate.size };
  });
}

export async function readDrive(deps: ScanDeps, names: Names): Promise<Read<DriveDoc>> {
  const t = await tokenFor(deps, "google", !!deps.google);
  if (t === ABSENT || t === null) return t;
  return guarded(deps, "google", t.key, t.account, async () => {
    const drive = deps.google!(t.refreshToken);
    const byDate = new Map<string, DriveDoc[]>();
    for (const d of await drive.listDocs()) {
      const date = dated("drive", d.name, d.id, names);
      if (date) push(byDate, date, { id: d.id, name: d.name, text: await orUnread(drive.exportText(d.id), null) });
    }
    return { value: byDate, count: byDate.size };
  });
}

export async function readPaper(deps: ScanDeps, names: Names): Promise<Read<PaperDoc>> {
  const t = await tokenFor(deps, "dropbox", !!deps.dropbox);
  if (t === ABSENT || t === null) return t;
  return guarded(deps, "dropbox", t.key, t.account, async () => {
    const dbx = deps.dropbox!(t.refreshToken);
    const byDate = new Map<string, PaperDoc[]>();
    // R3: .paper files named for a 2026 (or added 2025) show that mention Rhythm Lab, anywhere in the Dropbox.
    for (const f of await dbx.listFiles()) {
      const date = /\.paper$/i.test(f.name) && /rhythm lab/i.test(f.name) ? dated("paper", f.name, f.id, names) : null;
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
  // A scan already running (hourly, or a rescan) is not doubled: its caller's next turn catches up.
  if (deps.memory.scanning) return;
  deps.memory.scanning = true;
  try {
    await scanOnce(deps);
  } finally {
    deps.memory.scanning = false;
  }
}

/**
 * Plan 6b: the minute pass's check. A correction, placement or undo the last scan did not read starts one scan now,
 * however many were saved. A scan whose list() failed read none, so the next pass tries again.
 */
export async function rescanIfAsked(deps: ScanDeps): Promise<void> {
  if (deps.memory.scanning) return;
  try {
    const { rescanAfter } = await deps.convex.list();
    if (rescanAfter > deps.memory.seenRescanAfter) await runScan(deps);
  } catch {
    deps.log("ingest step=rescan ok=false");
  }
}

async function scanOnce(deps: ScanDeps): Promise<void> {
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
  // Read first: Tarik's placements date names while the sources are read; his corrections shape the episodes.
  const { episodes: stored, corrections, placements, rescanAfter, extraDates = [] } = await deps.convex.list();
  deps.memory.seenRescanAfter = rescanAfter;
  const names: Names = { placements, unplaced: [], extraDates: new Set(extraDates) };
  const box = use("box", "box", await readBox(deps, names));
  const drive = use("google", "drive", await readDrive(deps, names));
  const paper = use("dropbox", "paper", await readPaper(deps, names));
  deps.memory.lastScanComplete = failed.length === 0;

  const disk = await onDisk(deps.inboxDir, deps.preparedDir);
  let episodes = buildEpisodes({ box, drive, paper }, stored, disk.complete, corrections);
  // ponytail: a failed source with no earlier read in this process (just restarted) can't be merged column by column
  // (list never returns the notes text), so shows already stored keep all their facts until a good scan.
  if (uncached) {
    const known = new Set(stored.map((r) => r.showDate));
    episodes = episodes.filter((e) => !known.has(e.showDate));
  }
  // R5: a fix applied over a failed source's old read isn't settled: the show stays "checking your fix" (rescan
  // pending) until a complete scan applies it. Drafting is paused meanwhile anyway (R14).
  if (failed.length) episodes = episodes.map(({ appliedCorrectionAt, ...e }) => (void appliedCorrectionAt, e));
  let ok = 0;
  let questions = 0;
  for (const e of episodes) {
    questions += e.questions.length;
    // Hard Rule 8: the date only; never the id or name the correction pointed at.
    if (e.correctionStale) deps.log(`ingest date=${e.showDate} step=correction stale=true`);
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
  // A failed source's undated names are unknown, so the list is replaced only after a complete scan. A source that is
  // not connected has none, so (unlike prune) it does not block this.
  if (deps.memory.lastScanComplete) await reportUnplaced(deps, names.unplaced);
}

async function reportUnplaced(deps: ScanDeps, items: Unplaced[]): Promise<void> {
  try {
    await deps.convex.reportUnplaced(items);
  } catch {
    deps.log("ingest step=unplaced ok=false");
  }
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
