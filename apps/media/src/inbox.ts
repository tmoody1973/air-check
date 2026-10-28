import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { matchInbox } from "@aircheck/core";
import type { MediaConvex, WaitingItem } from "./convex.js";
import { encodeMp3, probeSeconds, sha256File, type Exec } from "./encode.js";

export interface PassDeps {
  convex: MediaConvex; exec: Exec; log: (line: string) => void;
  inboxDir: string; preparedDir: string; maxPrepared: number;
  /** When each package last failed. Pass the same map every pass (in memory only) to get the backoff. */
  failedAt?: Map<string, number>;
  now?: () => number;
}

/** After a failed encode or attach, leave that package alone this long. */
export const RETRY_BACKOFF_MS = 10 * 60_000;

const CLEANUP_ID = /^pkg-(\d{1,2})-(\d{1,2})-(\d{2})$/;
const pad = (n: string) => n.padStart(2, "0");
/** pkg-M-D-YY -> 20YY-MM-DD, or null for any other shape (never builds a path from it). */
export const folderForPackage = (id: string): string | null => {
  const m = CLEANUP_ID.exec(id);
  return m ? `20${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}` : null;
};
/** 2026-10-02 -> pkg-10-2-26 */
const packageForFolder = (date: string): string => `pkg-${Number(date.slice(5, 7))}-${Number(date.slice(8, 10))}-${date.slice(2, 4)}`;

/** Hard Rule 8: only the date, package id, step name, outcome and timing are ever logged. */
async function step<T>(deps: PassDeps, date: string, pkg: string, name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const line = (ok: boolean) => deps.log(`media date=${date} package=${pkg} step=${name} ok=${ok} ms=${Date.now() - t0}`);
  try { const r = await fn(); line(true); return r; } catch (e) { line(false); throw e; }
}

async function preparedCount(dir: string, except: string): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(".mp3") && n !== except).length;
}

async function cleanup(deps: PassDeps): Promise<void> {
  for (const id of await deps.convex.cleanup()) {
    const folder = folderForPackage(id);
    if (!folder) continue;
    await step(deps, folder, id, "cleanup", async () => {
      await rm(join(deps.preparedDir, `${id}.mp3`), { force: true });
      await rm(join(deps.inboxDir, folder), { recursive: true, force: true });
    }).catch(() => undefined);
  }
}

/** Joins, hashes and reports one matched folder. Throws on any failure; the caller turns that into a waiting reason. */
async function prepare(deps: PassDeps, date: string, pkg: string, dir: string, hour1: string, hour2: string): Promise<void> {
  const final = join(deps.preparedDir, `${pkg}.mp3`);
  const part = `${final}.part`;
  try {
    const created = await mkdir(deps.preparedDir, { recursive: true, mode: 0o755 });
    if (created) await chmod(deps.preparedDir, 0o755); // the console container runs as another uid and must read this
    const hour1DurationSec = await step(deps, date, pkg, "probe", async () => {
      const sec = await probeSeconds(deps.exec, join(dir, hour1));
      await probeSeconds(deps.exec, join(dir, hour2));
      return sec;
    });
    await step(deps, date, pkg, "encode", async () => {
      await encodeMp3(deps.exec, join(dir, hour1), join(dir, hour2), part);
      await chmod(part, 0o644);
      await rename(part, final);
    });
    const [mp3Sha256, mp3Bytes] = await step(deps, date, pkg, "hash", async () => [await sha256File(final), (await stat(final)).size] as const);
    await step(deps, date, pkg, "attach", () => deps.convex.attached({ packageId: pkg, hour1Id: hour1, hour2Id: hour2, mp3Sha256, hour1DurationSec, mp3Bytes }));
  } finally {
    await rm(part, { force: true });
  }
}

/** One scan of the inbox. Replaces the console's waiting list with whatever is still stuck. */
export async function runPass(deps: PassDeps): Promise<void> {
  await cleanup(deps).catch(() => deps.log("media step=cleanup ok=false"));
  const pending = await deps.convex.pending();
  const folders = await readdir(deps.inboxDir, { withFileTypes: true }).catch(() => []);
  const waiting: WaitingItem[] = [];
  const now = deps.now ?? Date.now;
  for (const entry of folders.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const date = entry.name;
    const dir = join(deps.inboxDir, date);
    const files = await readdir(dir).catch(() => null);
    if (!files) { waiting.push({ showDate: date, reason: `${date} folder could not be read` }); continue; }
    const m = matchInbox(date, files);
    if (!m.ok) { waiting.push({ showDate: date, reason: m.reason }); continue; }
    const pkg = pending.find((p) => p.showDate === date)?.packageId;
    if (!pkg) {
      // Already joined and handed to review: the MP3 is waiting for cleanup, nothing is stuck.
      const done = await stat(join(deps.preparedDir, `${packageForFolder(date)}.mp3`)).then(() => true, () => false);
      if (!done) waiting.push({ showDate: date, reason: `${date} has audio but no draft package for that date yet` });
      continue;
    }
    if ((await preparedCount(deps.preparedDir, `${pkg}.mp3`)) >= deps.maxPrepared) {
      waiting.push({ showDate: date, reason: `${date} waits: ${deps.maxPrepared} prepared shows are already waiting for review` });
      continue;
    }
    const failedReason = { showDate: date, reason: `Encoding failed for ${date}; will retry` };
    const failed = deps.failedAt?.get(pkg);
    if (failed !== undefined && now() - failed < RETRY_BACKOFF_MS) { waiting.push(failedReason); continue; }
    try {
      await prepare(deps, date, pkg, dir, m.hour1, m.hour2);
      deps.failedAt?.delete(pkg);
    } catch {
      deps.failedAt?.set(pkg, now());
      waiting.push(failedReason);
    }
  }
  await deps.convex.waiting(waiting);
}
