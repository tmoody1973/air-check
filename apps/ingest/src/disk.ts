import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EpisodeFacts } from "@aircheck/core";
import type { IngestRow } from "./convex.js";

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const PREPARED = /^pkg-(\d{1,2})-(\d{1,2})-(\d{2})\.mp3$/;
const pad = (n: string) => n.padStart(2, "0");
const list = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);

export interface OnDisk {
  /** Shows holding disk space: every inbox date folder and every prepared MP3 (the pace of 3 counts these). */
  held: Set<string>;
  /** Shows whose audio is all there: both hour WAVs in the inbox, or the joined MP3. */
  complete: Set<string>;
}

/** What is on disk now. Counted here, never trusted from the last scan (a fetch changes it within the hour). */
export async function onDisk(inboxDir: string, preparedDir: string): Promise<OnDisk> {
  const held = new Set<string>();
  const complete = new Set<string>();
  for (const e of await list(inboxDir)) {
    if (!e.isDirectory() || !DATE_DIR.test(e.name)) continue;
    held.add(e.name);
    const wavs = (await readdir(join(inboxDir, e.name)).catch(() => [])).filter((f) => /\.wav$/i.test(f));
    if (wavs.length >= 2) complete.add(e.name);
  }
  for (const e of await list(preparedDir)) {
    const m = PREPARED.exec(e.name);
    if (!e.isFile() || !m) continue;
    const date = `20${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}`;
    held.add(date);
    complete.add(date);
  }
  return { held, complete };
}

/** A `.part` in the inbox is a download that died with the process (only this service writes them, one at a time). */
export async function removeStaleParts(inboxDir: string): Promise<void> {
  for (const e of await list(inboxDir)) {
    if (!e.isDirectory() || !DATE_DIR.test(e.name)) continue;
    for (const f of await readdir(join(inboxDir, e.name)).catch(() => []))
      if (f.endsWith(".part")) await rm(join(inboxDir, e.name, f), { force: true });
  }
}

/** Core's view of a listed row. `audioOnDisk` comes from the disk when given (the row's is from the last scan). */
export function factsOf(row: IngestRow, audioOnDisk = row.audioOnDisk): EpisodeFacts {
  return {
    showDate: row.showDate,
    audio: { status: row.audio.status },
    tracklist: { status: row.tracklist.status },
    notes: { status: row.notes.status },
    questions: row.questions,
    packageStatus: row.packageStatus,
    draftAttempts: row.draftAttempts,
    ...(audioOnDisk !== undefined && { audioOnDisk }),
    ...(row.rerunOf && { rerunOf: row.rerunOf, ...(row.rerunSource && { rerunSource: row.rerunSource }) }),
    ...(row.rerunDeclined && { rerunDeclined: row.rerunDeclined }),
    ...(row.tracks && { tracks: row.tracks }),
  };
}
