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

/** Order and count come from Drive; spelling comes from Paper. Nothing is dropped or added. */
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
      const same = match.artist === t.artist && match.title === t.title;
      return { ...t, artist: match.artist, title: match.title, status: same ? "confirmed" : "spelling-fixed" };
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

