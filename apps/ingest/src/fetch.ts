import { mkdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { nextAudioToFetch } from "@aircheck/core";
import { MAX_DOWNLOAD_BYTES, type BoxClient } from "./box.js";
import type { IngestConvex } from "./convex.js";
import { factsOf, onDisk, removeStaleParts } from "./disk.js";
import { AuthRefused, HttpError } from "./http.js";

/** Tarik's call: about 3 shows' audio on disk at a time (inbox WAVs + prepared MP3s). */
export const MAX_ON_DISK = 3;
/** After a failed download, leave that show alone this long (like media's encode backoff). */
export const RETRY_BACKOFF_MS = 10 * 60_000;
/** After this many failures in a row a show is not tried again (until a restart); Episodes shows it as failed. */
export const MAX_FETCH_FAILURES = 3;

export interface FetchDeps {
  convex: IngestConvex; log: (line: string) => void; box: BoxClient | null;
  inboxDir: string; preparedDir: string;
  /** Each show's failures in a row and when the last one was. Same map every pass (memory only). */
  failures: Map<string, { count: number; at: number }>;
  now?: () => number;
}

/**
 * The inbox name for an hour: the hour assemble decided, then Box's name made filename-safe. matchInbox orders a folder
 * by leading digits, so "1-…" and "2-…" are always hour 1 and hour 2, whatever the Box pattern was.
 */
export const inboxName = (hour: 1 | 2, original: string) => `${hour}-${original.replace(/[^A-Za-z0-9 ._()-]/g, "_")}`;

const exists = (p: string) => stat(p).then(() => true, () => false);

/** One pass: fetch the next show's two WAVs from Box, if one is due and fewer than 3 shows' audio are on disk. */
export async function fetchPass(deps: FetchDeps): Promise<void> {
  if (!deps.box) return;
  const now = deps.now ?? Date.now;
  await removeStaleParts(deps.inboxDir);
  const [{ episodes }, disk] = await Promise.all([deps.convex.list(), onDisk(deps.inboxDir, deps.preparedDir)]);
  const backingOff = (d: string) => {
    const f = deps.failures.get(d);
    return !!f && (f.count >= MAX_FETCH_FAILURES || now() - f.at < RETRY_BACKOFF_MS);
  };
  const facts = episodes.filter((r) => !backingOff(r.showDate)).map((r) => factsOf(r, disk.complete.has(r.showDate)));
  // A show half on disk (a failed or interrupted download) already holds its space: finish it first.
  const half = facts.filter((f) => disk.held.has(f.showDate));
  const next = nextAudioToFetch(half, 0, MAX_ON_DISK) ?? nextAudioToFetch(facts, disk.held.size, MAX_ON_DISK);
  if (!next) return;
  const row = episodes.find((r) => r.showDate === next.showDate)!;
  const { hour1, hour2 } = row.audio;
  if (!hour1 || !hour2) return;

  const date = row.showDate;
  const dir = join(deps.inboxDir, date);
  const t0 = now();
  const ours = [join(dir, inboxName(1, hour1.name)), join(dir, inboxName(2, hour2.name))] as const;
  let bytes = 0;
  try {
    // Both sizes first: nothing is downloaded and no folder is made for a show that can't be fetched whole.
    if (hour1.size > MAX_DOWNLOAD_BYTES || hour2.size > MAX_DOWNLOAD_BYTES) throw new HttpError(0, "too_large");
    await deps.convex.setFetch(date, "fetching");
    await mkdir(dir, { recursive: true, mode: 0o755 });
    for (const [i, f] of [hour1, hour2].entries()) {
      if (await exists(ours[i]!)) continue; // a final name appears only after a whole, size-checked download
      bytes += await deps.box.download(f.id, ours[i]!, f.size);
    }
    await deps.convex.setFetch(date, "fetched");
    deps.failures.delete(date);
    deps.log(`ingest date=${date} step=fetch ok=true bytes=${bytes} ms=${now() - t0}`);
  } catch (e) {
    const error = e instanceof HttpError || e instanceof AuthRefused ? e.message : "download_failed";
    const count = (deps.failures.get(date)?.count ?? 0) + 1;
    deps.failures.set(date, { count, at: now() });
    // Given up: our finished hour goes too. Then the folder goes if nothing else is in it (a finished hour is kept to
    // resume; anything Tarik put there keeps it). Either way a failing show stops holding a disk slot.
    if (count >= MAX_FETCH_FAILURES) for (const p of ours) await rm(p, { force: true });
    await rmdir(dir).catch(() => undefined);
    deps.log(`ingest date=${date} step=fetch ok=false error=${error} attempts=${count} ms=${now() - t0}`);
    await deps.convex.setFetch(date, "failed", error).catch(() => undefined);
  }
}
