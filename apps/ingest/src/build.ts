import { createHash } from "node:crypto";
import {
  parseDriveTracklist, parsePaperExport, reconcile, rerunCandidate,
  type BoxFile, type EpisodeAssembly, type EpisodeFacts, type PaperTrack, type ParsedTracklist, type Track, type TrackStatus,
} from "@aircheck/core";
import type { Choice, Correction, Fix, IngestRow, Question, QuestionKind, ScannedEpisode, ScannedTrack } from "./convex.js";
import type { PaperExport } from "./dropbox.js";

// From what the three sources hold to one episode per show date, with core's rules. Pure: no I/O, so it is tested
// directly. "Never guess": anything the rules can't settle becomes a plain question for Tarik.

/** `wavs`: every .wav in the folder, offered when Tarik picks the two hours himself (Plan 6b). */
export interface BoxFolder { id: string; name: string; assembly: EpisodeAssembly; wavs: BoxFile[] }
/** `text` null: Drive would not export it (that doc's question). */
export interface DriveDoc { id: string; name: string; text: string | null }
export interface PaperDoc { id: string; name: string; export: PaperExport }
export interface Found { box: Map<string, BoxFolder[]>; drive: Map<string, DriveDoc[]>; paper: Map<string, PaperDoc[]> }

// Convex's upsert limits (apps/console/convex/ingest.ts): kept here so one show never fails its whole upsert.
const MAX_QUESTIONS = 20;
const MAX_QUESTION_CHARS = 1_000;
const MAX_NOTES_BYTES = 65_536;
const MAX_TRACKS = 100;
/** The editor's text, the same cap as a typed tracklist (MAX_NOTES in apps/console/convex/tracklist.ts). */
const MAX_TRACKLIST_TEXT = 20_000;
const MAX_CHOICES = 20;
/** A typed tracklist's docId: it came from Air Check, not a Drive doc. */
const TYPED_DOC_ID = "air-check";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** The id is derived from the text, so an answer carries over while the question stays the same (and only then). */
function ask(kind: QuestionKind, text: string, rerunOf?: string): Question {
  const t = text.length > MAX_QUESTION_CHARS ? `${text.slice(0, MAX_QUESTION_CHARS - 1)}…` : text;
  return { id: `${kind}-${sha(t)}`, text: t, kind, ...(rerunOf !== undefined && { rerunOf }) };
}
/** Plan 6b: the choice the console offers to settle a question in Air Check. */
const offer = (q: Question, f: Fix): Question => ({ ...q, fix: f });

/** M6: a question only a fix in Box, Drive or Paper (or now in Air Check) settles. No answer box; it clears when the scan stops raising it. */
const fix = (kind: QuestionKind, text: string, f?: Fix): Question => ({ ...ask(kind, text), action: true, ...(f && { fix: f }) });
const TRACKLIST_FIX: Fix = { type: "tracklist" };
const choices = (items: { id: string; name: string }[]): Choice[] => items.slice(0, MAX_CHOICES).map(({ id, name }) => ({ id, name }));

const hasBothHours = (p: ParsedTracklist) => ([1, 2] as const).every((h) => p.tracks.some((t) => t.hour === h));

const scannedTrack = (t: Track, status: TrackStatus): ScannedTrack => ({
  hour: t.hour, position: t.position, artist: t.artist, title: t.title, ...(t.feat ? { feat: t.feat } : {}), raw: t.raw, closing: t.closing, status,
});

/**
 * A pick narrows a source's list to the chosen doc or folder. A pick whose item is gone (deleted, renamed out of the
 * date) is ignored, so the original question comes back, and the correction is marked stale (Review Focus 1).
 */
function picked<T extends { id: string }>(items: T[] | undefined, id: string | undefined, stale: () => void): T[] | undefined {
  if (id === undefined) return items;
  const hit = items?.filter((x) => x.id === id);
  if (hit?.length) return hit;
  stale();
  return items;
}

function audioOf(date: string, folders: BoxFolder[] | undefined, q: Question[], c: Correction | undefined, stale: () => void): { audio: ScannedEpisode["audio"]; stampDate?: string } {
  const wantsFolder = !!(c?.hours || c?.folderDate);
  if (!folders?.length) {
    if (wantsFolder) stale();
    return { audio: { status: "none", flags: [] } };
  }
  if (folders.length > 1) {
    if (wantsFolder) stale();
    q.push(fix("audio", `Box has ${folders.length} folders dated ${date} (${folders.map((f) => `"${f.name}"`).join(", ")}). Remove or rename the extra folder in Box; until then its audio is not used automatically.`,
      { type: "pick", source: "box", choices: choices(folders) }));
    return { audio: { status: "ask", flags: ["more than one Box folder for this date"] } };
  }
  const [{ id, name, assembly: a, wavs }] = folders as [BoxFolder];
  const file = (f: BoxFile) => ({ id: f.id, name: f.name, size: f.size });
  const stamp = a.stampDate ? { stampDate: a.stampDate } : {};
  // Tarik's two hour files win over the folder's pattern, whatever its name.
  if (c?.hours) {
    const [h1, h2] = [c.hours.hour1, c.hours.hour2].map((fid) => wavs.find((w) => w.id === fid));
    if (h1 && h2 && h1 !== h2) return { audio: { status: "ready", folderId: id, hour1: file(h1), hour2: file(h2), pattern: "picked", flags: [] }, ...stamp };
    stale();
  }
  const audio: ScannedEpisode["audio"] = {
    status: a.status, folderId: id, flags: a.flags,
    ...(a.hour1 && { hour1: file(a.hour1) }), ...(a.hour2 && { hour2: file(a.hour2) }), ...(a.pattern && { pattern: a.pattern }),
  };
  const mismatch = a.status === "ask" && a.flags.includes("date mismatch");
  if (c?.folderDate) {
    // The folder's date stands; the stamp still feeds the rerun hint.
    if (mismatch) return { audio: { ...audio, status: "ready", flags: a.flags.filter((f) => f !== "date mismatch") }, ...stamp };
    stale();
  }
  if (a.status === "ask") {
    if (mismatch) {
      const q0 = ask("date", `The Box folder for ${date} holds hour files stamped ${a.stampDate ?? "with another date"}. Which date is this show?`);
      // ponytail: a stamp that is not a real date offers no button; the answer box still takes it.
      q.push(a.stampDate ? offer(q0, { type: "stamp", folderDate: date, stampDate: a.stampDate }) : q0);
    } else {
      const q0 = ask("audio", `The Box folder "${name}" is a special folder (RECAP, Best of or an unusual name), so its audio is not used automatically. If ${date} should be posted, copy its two hour WAVs into the inbox by hand.`);
      q.push(wavs.length >= 2 ? offer(q0, { type: "hours", choices: choices(wavs) }) : q0);
    }
  }
  return { audio, ...stamp };
}

function notesOf(date: string, docs: PaperDoc[] | undefined, q: Question[]): { notes: ScannedEpisode["notes"]; paper: PaperTrack[] | null } {
  if (!docs?.length) return { notes: { status: "missing" }, paper: null }; // a gap, never a blocker (skill: notes for new shows)
  if (docs.length > 1) {
    q.push(fix("tracklist", `Dropbox has ${docs.length} Paper docs for ${date} (${docs.map((d) => `"${d.name}"`).join(", ")}). Trash or rename the extra one so the right notes are used.`,
      { type: "pick", source: "paper", choices: choices(docs) }));
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
  return { notes: { status: "found", docId: doc.id, text }, paper: parsed.tracks.length ? parsed.tracks : null };
}

/** The chosen tracklist's tracks and their questions; `where` names it in those questions. undefined: too many tracks. */
function tracksOf(date: string, p: ParsedTracklist, paper: PaperTrack[] | null, where: string, q: Question[]): ScannedTrack[] | undefined {
  // Drive decides (Tarik, Oct 28): most Paper notes are about the artists, not a track list, so the notes never raise a
  // question. Paper only fixes the spelling of a track it matches; Drive's order and count stand.
  const tracks: ScannedTrack[] = paper
    ? reconcile(p, paper).tracks.map((t) => scannedTrack(t, t.status))
    : p.tracks.map((t) => scannedTrack(t, t.closing ? "closing-track" : "unverified-in-notes"));
  q.push(...p.bad.map((b) => fix("tracklist", `Line ${b.line} "${b.raw}" could not be read (${b.reason}). Fix it so no track is missed.`, TRACKLIST_FIX)));
  for (const h of [1, 2] as const)
    if (!tracks.some((t) => t.hour === h)) q.push(fix("tracklist", `The tracklist for ${date} has no Hour ${h} tracks. Check ${where}.`, TRACKLIST_FIX));
  if (tracks.length > MAX_TRACKS) {
    q.push(fix("tracklist", `The tracklist for ${date} has ${tracks.length} tracks, more than a show can hold. Check ${where}.`, TRACKLIST_FIX));
    return undefined;
  }
  return tracks;
}

/** A tracklist Tarik typed in Air Check: used exactly as typed, so Paper never changes its spelling. */
function typedTracklist(date: string, text: string, q: Question[]): { tracklist: ScannedEpisode["tracklist"]; docTitle?: string } {
  const tracks = tracksOf(date, parseDriveTracklist(text), null, "the tracklist fixed in Air Check", q);
  return { tracklist: { status: "found", docId: TYPED_DOC_ID, ...(tracks && { tracks }) } };
}

function tracklistOf(date: string, docs: DriveDoc[] | undefined, paper: PaperTrack[] | null, q: Question[]): { tracklist: ScannedEpisode["tracklist"]; docTitle?: string } {
  if (!docs?.length) return { tracklist: { status: "missing" } };
  for (const d of docs.filter((x) => x.text === null))
    // R2: Tarik can type the tracklist in Air Check instead; a typed tracklist replaces Drive for the date.
    q.push(offer(ask("tracklist", `The tracklist "${d.name}" for ${date} could not be read from Drive. Check the doc.`), TRACKLIST_FIX));
  const readable = docs.filter((d): d is DriveDoc & { text: string } => d.text !== null);
  if (!readable.length) return { tracklist: { status: "missing" } };
  const parsed = readable.map((d) => ({ d, p: parseDriveTracklist(d.text) }));
  // Rule 7: of two docs for one date, use the one with the HOUR 1 / HOUR 2 structure. Anything else is a question.
  const structured = parsed.filter((x) => hasBothHours(x.p));
  const pick = structured.length === 1 ? structured[0] : parsed.length === 1 ? parsed[0] : undefined;
  if (!pick) {
    q.push(fix("tracklist", `Drive has ${docs.length} tracklists for ${date} (${docs.map((d) => `"${d.name}"`).join(", ")}) and the right one is unclear. Trash or rename the extra one.`,
      { type: "pick", source: "drive", choices: choices(readable) }));
    return { tracklist: { status: "missing" } };
  }
  const tracks = tracksOf(date, pick.p, paper, `the Drive doc "${pick.d.name}"`, q);
  const text = pick.d.text.slice(0, MAX_TRACKLIST_TEXT);
  return { tracklist: { status: "found", docId: pick.d.id, ...(tracks && { tracks }), text }, docTitle: pick.d.name };
}

/** At most 20 questions (Convex's limit): the rest are summed up in the 20th, so the show still blocks and says why. */
function capped(date: string, q: Question[]): Question[] {
  if (q.length <= MAX_QUESTIONS) return q;
  const more = q.length - (MAX_QUESTIONS - 1);
  return [...q.slice(0, MAX_QUESTIONS - 1), fix("tracklist", `…and ${more} more problems with the docs for ${date}. Fix the docs and they will be checked again.`)];
}

/**
 * One episode per show date found in any source. `stored` carries the rerun marks; `onDisk` the local audio;
 * `corrections` the fixes Tarik saved in Air Check (Plan 6b), applied before the rules run.
 */
export function buildEpisodes(found: Found, stored: IngestRow[], onDisk: Set<string>, corrections: Correction[] = []): ScannedEpisode[] {
  const dates = [...new Set([...found.box.keys(), ...found.drive.keys(), ...found.paper.keys()])].sort();
  const fixes = new Map(corrections.map((c) => [c.showDate, c]));
  const built = dates.map((date) => {
    const q: Question[] = [];
    const c = fixes.get(date);
    let isStale = false;
    const stale = () => void (isStale = true);
    const { audio, stampDate } = audioOf(date, picked(found.box.get(date), c?.box, stale), q, c, stale);
    const { notes, paper } = notesOf(date, picked(found.paper.get(date), c?.paper, stale), q);
    const { tracklist, docTitle } = c?.tracklistText !== undefined
      ? typedTracklist(date, c.tracklistText, q)
      : tracklistOf(date, picked(found.drive.get(date), c?.drive, stale), paper, q);
    const episode: ScannedEpisode = {
      showDate: date, audio, tracklist, notes, questions: q, audioOnDisk: onDisk.has(date), ...(isStale ? { correctionStale: true as const } : {}),
    };
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
