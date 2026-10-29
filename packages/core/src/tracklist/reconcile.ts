import type { Hour, ParsedTracklist, Track } from "../types";
import { levenshtein, normalize } from "./normalize";

export interface PaperTrack {
  hour: Hour;
  artist: string;
  title: string;
}

export type TrackStatus = "confirmed" | "spelling-fixed" | "unverified-in-notes" | "closing-track";

export interface ReconciledTrack extends Track {
  status: TrackStatus;
}

export interface Reconciled {
  tracks: ReconciledTrack[];
  questions: string[];
}

function findMatch(t: Track, candidates: PaperTrack[], used: Set<PaperTrack>): PaperTrack | undefined {
  const free = candidates.filter((p) => !used.has(p));
  const title = normalize(t.title);
  return (
    free.find((p) => normalize(p.title) === title) ??
    free.find((p) => normalize(p.artist) === normalize(t.artist) && levenshtein(normalize(p.title), title) <= 2)
  );
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** True when `short` is `long` with at most `max` characters removed (case-sensitive). */
function droppedAtMost(short: string, long: string, max: number): boolean {
  if (long.length < short.length || long.length - short.length > max) return false;
  let i = 0;
  for (const c of long) if (i < short.length && c === short[i]) i++;
  return i === short.length;
}

/** Paper's form wins only when it is Drive's own spelling with accents restored or at most 2 dropped characters put back
 * ("Ly Qua Dub" → "Lý Qua Dub", "Cndor" → "Cóndor"). Case, punctuation style and added words keep Drive's spelling:
 * Tarik's notes write "ROY AYERS", "LEIKELI47", "Funk Factory (Michał Urbaniak)" (4-17-26, 1-9-26). */
function spelling(drive: string, paper: string): string {
  return paper !== drive && droppedAtMost(drive, stripAccents(paper), 2) ? paper : drive;
}

/** Order and count come from Drive; Paper only restores accents and dropped characters. Nothing is dropped or added. */
export function reconcile(drive: ParsedTracklist, paper: PaperTrack[]): Reconciled {
  const used = new Set<PaperTrack>();
  const questions: string[] = [];

  const tracks = drive.tracks.map((t): ReconciledTrack => {
    const match = findMatch(
      t,
      paper.filter((p) => p.hour === t.hour),
      used,
    );
    if (match) {
      used.add(match);
      const artist = spelling(t.artist, match.artist);
      const title = spelling(t.title, match.title);
      const same = artist === t.artist && title === t.title;
      return { ...t, artist, title, status: same ? "confirmed" : "spelling-fixed" };
    }
    if (t.closing) return { ...t, status: "closing-track" };
    questions.push(
      `Hour ${t.hour} track ${t.position} "${t.artist} - ${t.title}" is in the tracklist but not in the notes. Keep it?`,
    );
    return { ...t, status: "unverified-in-notes" };
  });

  for (const b of drive.bad)
    questions.push(`Line ${b.line} "${b.raw}" could not be read (${b.reason}). Fix it so no track is missed.`);
  for (const p of paper.filter((p) => !used.has(p)))
    questions.push(`"${p.artist} - ${p.title}" is in the notes (hour ${p.hour}) but not in the tracklist.`);

  return { tracks, questions };
}

