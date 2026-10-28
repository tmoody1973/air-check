import { createHash } from "node:crypto";
import {
  parsePaperExport, parseTracklist, reconcile, rerunCandidate,
  type EpisodeAssembly, type EpisodeFacts, type PaperTrack, type ParsedTracklist, type Track, type TrackStatus,
} from "@aircheck/core";
import type { IngestRow, QuestionKind, ScannedEpisode, ScannedTrack } from "./convex.js";
import type { PaperExport } from "./dropbox.js";

// From what the three sources hold to one episode per show date, with core's rules. Pure: no I/O, so it is tested
// directly. "Never guess": anything the rules can't settle becomes a plain question for Tarik.

export interface BoxFolder { id: string; name: string; assembly: EpisodeAssembly }
/** `text` null: Drive would not export it (that doc's question). */
export interface DriveDoc { id: string; name: string; text: string | null }
export interface PaperDoc { id: string; name: string; export: PaperExport }
export interface Found { box: Map<string, BoxFolder[]>; drive: Map<string, DriveDoc[]>; paper: Map<string, PaperDoc[]> }

// Convex's upsert limits (apps/console/convex/ingest.ts): kept here so one show never fails its whole upsert.
const MAX_QUESTIONS = 20;
const MAX_QUESTION_CHARS = 1_000;
const MAX_NOTES_BYTES = 65_536;
const MAX_TRACKS = 100;
const SPACED_DASH = /\s[-–—]\s/;

type Question = ScannedEpisode["questions"][number];
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** The id is derived from the text, so an answer carries over while the question stays the same (and only then). */
function ask(kind: QuestionKind, text: string, rerunOf?: string): Question {
  const t = text.length > MAX_QUESTION_CHARS ? `${text.slice(0, MAX_QUESTION_CHARS - 1)}…` : text;
  return { id: `${kind}-${sha(t)}`, text: t, kind, ...(rerunOf !== undefined && { rerunOf }) };
}

/** Drive's text export, read by core. A title or byline above HOUR 1 is not a track; a track-like line there still is. */
function parseDrive(text: string): ParsedTracklist {
  const p = parseTracklist(text);
  return { tracks: p.tracks, bad: p.bad.filter((b) => b.reason !== "before-hour-marker" || SPACED_DASH.test(b.raw)) };
}
const hasBothHours = (p: ParsedTracklist) => ([1, 2] as const).every((h) => p.tracks.some((t) => t.hour === h));

const scannedTrack = (t: Track, status: TrackStatus): ScannedTrack => ({
  hour: t.hour, position: t.position, artist: t.artist, title: t.title, ...(t.feat ? { feat: t.feat } : {}), raw: t.raw, closing: t.closing, status,
});

function audioOf(date: string, folders: BoxFolder[] | undefined, q: Question[]): { audio: ScannedEpisode["audio"]; stampDate?: string } {
  if (!folders?.length) return { audio: { status: "none", flags: [] } };
  if (folders.length > 1) {
    q.push(ask("audio", `Box has ${folders.length} folders dated ${date} (${folders.map((f) => `"${f.name}"`).join(", ")}). Which one is the show? Until one is removed or renamed, its audio is not used automatically.`));
    return { audio: { status: "ask", flags: ["more than one Box folder for this date"] } };
  }
  const [{ id, name, assembly: a }] = folders as [BoxFolder];
  const file = (f: { id: string; name: string; size: number }) => ({ id: f.id, name: f.name, size: f.size });
  const audio: ScannedEpisode["audio"] = {
    status: a.status, folderId: id, flags: a.flags,
    ...(a.hour1 && { hour1: file(a.hour1) }), ...(a.hour2 && { hour2: file(a.hour2) }), ...(a.pattern && { pattern: a.pattern }),
  };
  if (a.status === "ask") {
    q.push(a.flags.includes("date mismatch")
      ? ask("date", `The Box folder for ${date} holds hour files stamped ${a.stampDate ?? "with another date"}. Which date is this show?`)
      : ask("audio", `The Box folder "${name}" is a special folder (RECAP, Best of or an unusual name), so its audio is not used automatically. If ${date} should be posted, copy its two hour WAVs into the inbox by hand.`));
  }
  return { audio, ...(a.stampDate && { stampDate: a.stampDate }) };
}

function notesOf(date: string, docs: PaperDoc[] | undefined, q: Question[]): { notes: ScannedEpisode["notes"]; paper: PaperTrack[] | null } {
  if (!docs?.length) return { notes: { status: "missing" }, paper: null }; // a gap, never a blocker (skill: notes for new shows)
  if (docs.length > 1) {
    q.push(ask("tracklist", `Dropbox has ${docs.length} Paper docs for ${date} (${docs.map((d) => `"${d.name}"`).join(", ")}). Trash or rename the extra one so the right notes are used.`));
    return { notes: { status: "found" }, paper: null };
  }
  const [doc] = docs as [PaperDoc];
  if (doc.export.kind !== "ok") {
    q.push(ask("tracklist", `The notes for ${date} could not be read (Dropbox offered no text export of "${doc.name}"). Check the Paper doc.`));
    return { notes: { status: "found", docId: doc.id }, paper: null };
  }
  const text = doc.export.text;
  if (Buffer.byteLength(text) > MAX_NOTES_BYTES) {
    q.push(ask("tracklist", `The notes for ${date} are over 64 KB, too long to use. Check the Paper doc "${doc.name}".`));
    return { notes: { status: "found", docId: doc.id }, paper: null };
  }
  const parsed = parsePaperExport(text);
  if (parsed.unreadable) q.push(ask("tracklist", `The notes for ${date} could not be read as a track list (no "Artist – "Title"" lines under Hour headings). Check the Paper doc "${doc.name}".`));
  return { notes: { status: "found", docId: doc.id, text }, paper: parsed.tracks.length ? parsed.tracks : null };
}

function tracklistOf(date: string, docs: DriveDoc[] | undefined, paper: PaperTrack[] | null, q: Question[]): { tracklist: ScannedEpisode["tracklist"]; docTitle?: string } {
  if (!docs?.length) return { tracklist: { status: "missing" } };
  for (const d of docs.filter((x) => x.text === null))
    q.push(ask("tracklist", `The tracklist "${d.name}" for ${date} could not be read from Drive. Check the doc.`));
  const readable = docs.filter((d): d is DriveDoc & { text: string } => d.text !== null);
  if (!readable.length) return { tracklist: { status: "missing" } };
  const parsed = readable.map((d) => ({ d, p: parseDrive(d.text) }));
  // Rule 7: of two docs for one date, use the one with the HOUR 1 / HOUR 2 structure. Anything else is a question.
  const structured = parsed.filter((x) => hasBothHours(x.p));
  const pick = structured.length === 1 ? structured[0] : parsed.length === 1 ? parsed[0] : undefined;
  if (!pick) {
    q.push(ask("tracklist", `Drive has ${docs.length} tracklists for ${date} (${docs.map((d) => `"${d.name}"`).join(", ")}) and the right one is unclear. Trash or rename the extra one.`));
    return { tracklist: { status: "missing" } };
  }
  let tracks: ScannedTrack[];
  if (paper) {
    const r = reconcile(pick.p, paper);
    tracks = r.tracks.map((t) => scannedTrack(t, t.status));
    q.push(...r.questions.map((text) => ask("tracklist", text)));
  } else {
    // No usable notes: nothing confirms the tracks, and that alone is not a question per track.
    tracks = pick.p.tracks.map((t) => scannedTrack(t, t.closing ? "closing-track" : "unverified-in-notes"));
    q.push(...pick.p.bad.map((b) => ask("tracklist", `Line ${b.line} "${b.raw}" could not be read (${b.reason}). Fix it so no track is missed.`)));
  }
  for (const h of [1, 2] as const)
    if (!tracks.some((t) => t.hour === h)) q.push(ask("tracklist", `The tracklist for ${date} has no Hour ${h} tracks. Check the Drive doc "${pick.d.name}".`));
  if (tracks.length > MAX_TRACKS) {
    q.push(ask("tracklist", `The tracklist for ${date} has ${tracks.length} tracks, more than a show can hold. Check the Drive doc "${pick.d.name}".`));
    return { tracklist: { status: "found", docId: pick.d.id }, docTitle: pick.d.name };
  }
  return { tracklist: { status: "found", docId: pick.d.id, tracks }, docTitle: pick.d.name };
}

/** At most 20 questions (Convex's limit): the rest are summed up in the 20th, so the show still blocks and says why. */
function capped(date: string, q: Question[]): Question[] {
  if (q.length <= MAX_QUESTIONS) return q;
  const more = q.length - (MAX_QUESTIONS - 1);
  return [...q.slice(0, MAX_QUESTIONS - 1), ask("tracklist", `…and ${more} more differences between the tracklist and the notes for ${date}. Fix the docs and they will be checked again.`)];
}

/** One episode per show date found in any source. `stored` carries the rerun marks; `onDisk` the local audio. */
export function buildEpisodes(found: Found, stored: IngestRow[], onDisk: Set<string>): ScannedEpisode[] {
  const dates = [...new Set([...found.box.keys(), ...found.drive.keys(), ...found.paper.keys()])].sort();
  const built = dates.map((date) => {
    const q: Question[] = [];
    const { audio, stampDate } = audioOf(date, found.box.get(date), q);
    const { notes, paper } = notesOf(date, found.paper.get(date), q);
    const { tracklist, docTitle } = tracklistOf(date, found.drive.get(date), paper, q);
    const episode: ScannedEpisode = { showDate: date, audio, tracklist, notes, questions: q, audioOnDisk: onDisk.has(date) };
    return { episode, stampDate, docTitle };
  });

  // R6/R8: a hint becomes the question "Is <date> a rerun of <date>?"; a week marked or declined never asks (R7).
  const marks = new Map(stored.map((r) => [r.showDate, r]));
  const facts = built.map(({ episode: e, stampDate, docTitle }): EpisodeFacts => ({
    showDate: e.showDate, audio: { status: e.audio.status }, tracklist: { status: e.tracklist.status }, notes: { status: e.notes.status },
    questions: [], packageStatus: "none",
    ...(e.tracklist.tracks && { tracks: e.tracklist.tracks }), ...(stampDate && { stampDate }), ...(docTitle && { docTitle }),
    ...(marks.get(e.showDate)?.rerunOf && { rerunOf: marks.get(e.showDate)!.rerunOf }),
    ...(marks.get(e.showDate)?.rerunDeclined && { rerunDeclined: true as const }),
  }));
  return built.map(({ episode }, i) => {
    const hint = rerunCandidate(facts[i]!, facts);
    const date = episode.showDate;
    if (hint) episode.questions.push(ask("rerun", hint.of ? `Is ${date} a rerun of ${hint.of}? ${hint.reason}` : `Is ${date} a rerun, and of which show? ${hint.reason}`, hint.of));
    return { ...episode, questions: capped(date, episode.questions) };
  });
}
