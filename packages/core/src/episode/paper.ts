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
// "## 1. Artist – "Title"" (older show notes), "### 1. Artist, "Title"" (his Oct 23 notes and Air Check's export since
// Oct 29) or a plain "1. Artist - "Title"". The title must be quoted.
const NUMBERED = /^(?:#{1,6}\s+)?\d+\.\s+(.+?)(?:\s+[–—-]|,)\s+["“](.+)["”]/;

const clean = (s: string) => s.replace(/\*\*/g, "").trim();

/** Tolerant reader for a Paper export: Hour headings set the hour, only track lines are kept, nothing is guessed. */
export function parsePaperExport(text: string): PaperParse {
  const tracks: PaperTrack[] = [];
  const lines = text.split(/\r?\n/);
  // Nov 20 (11-13-26 notes): Hour 1's tracks come first with no heading, only "Hour Two" has one. When the doc has an
  // Hour 2 heading, numbered tracks before any hour heading are Hour 1. With no hour headings at all, nothing is guessed.
  const hourOf = (l: string) => (l.match(HOUR_HEADING) ?? l.match(HOUR_MARKER))?.[1];
  let hour: Hour | null = lines.some((l) => HOUR_WORD[hourOf(l.trim())?.toLowerCase() ?? ""] === 2) ? 1 : null;
  for (const raw of lines) {
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
    const h = hourOf(line);
    if (h) hour = HOUR_WORD[h.toLowerCase()]!;
  }
  return { tracks, unreadable: tracks.length === 0 && text.trim().length > 0 };
}
