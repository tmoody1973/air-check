import type { Hour } from "../types";
import type { PaperTrack } from "../tracklist/reconcile";

export interface PaperParse {
  tracks: PaperTrack[];
  /** A non-empty document that yielded no tracks: the caller asks a person. */
  unreadable: boolean;
}

const HOUR_WORD: Record<string, Hour> = { "1": 1, one: 1, "2": 2, two: 2 };
const HOUR_HEADING = /^#{1,6}\s.*?\bhour\s*(1|2|one|two)\b/i;
const HOUR_MARKER = /^[#*\s]*hour\s*(1|2|one|two)\b[\s:–—*-]*$/i;
const SYNTH = /^H([12])\s*\|\s*(.+?)\s*\|\s*(.+?)\s*$/;
// "## 1. Artist – "Title"" (real show notes) or a plain "1. Artist - "Title"". The title must be quoted.
const NUMBERED = /^(?:#{1,6}\s+)?\d+\.\s+(.+?)\s+[–—-]\s+["“](.+)["”]/;

const clean = (s: string) => s.replace(/\*\*/g, "").trim();

/** Tolerant reader for a Paper export: Hour headings set the hour, only track lines are kept, nothing is guessed. */
export function parsePaperExport(text: string): PaperParse {
  const tracks: PaperTrack[] = [];
  let hour: Hour | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const synth = line.match(SYNTH);
    if (synth) {
      tracks.push({ hour: Number(synth[1]) as Hour, artist: synth[2]!, title: synth[3]! });
      continue;
    }
    const numbered = hour && line.match(NUMBERED);
    if (numbered) {
      tracks.push({ hour: hour!, artist: clean(numbered[1]!), title: clean(numbered[2]!) });
      continue;
    }
    const h = line.match(HOUR_HEADING) ?? line.match(HOUR_MARKER);
    if (h) hour = HOUR_WORD[h[1]!.toLowerCase()]!;
  }
  return { tracks, unreadable: tracks.length === 0 && text.trim().length > 0 };
}
