import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { showDateLabel } from "../lib/date";
import { BTN } from "./MixcloudConnection";

// The Episodes page's controls, shared by the table and the phone cards (EpisodeItem): answer boxes, rerun questions,
// the rerun line with Undo, Mark as rerun of…, and the R5 how-to (Plan 6b fixes: FixControl, TracklistFix). Each calls an injected action, never the model.

export type FixSource = "box" | "drive" | "paper";
type Choice = { id: string; name: string };
/** What the console can offer to settle a question (mirrors the ingest service's Fix, Plan 6b). */
export type Fix =
  | { type: "tracklist" }
  | { type: "pick"; source: FixSource; choices: Choice[] }
  | { type: "hours"; choices: Choice[] }
  | { type: "stamp"; folderDate: string; stampDate: string };
export type Question = { id: string; text: string; kind: "audio" | "date" | "tracklist" | "rerun"; rerunOf?: string; action?: true; answer?: string; fix?: Fix };
export type CorrectedField = "tracklist" | "drive" | "paper" | "box" | "hours" | "folderDate";
export type EpisodeRow = {
  showDate: string;
  audio: { status: "ready" | "incomplete" | "ask" | "none" };
  tracklist: { status: "found" | "missing" };
  notes: { status: "found" | "missing" };
  questions: Question[];
  status: string;
  gaps: string[];
  packageId: string;
  packageStatus: string;
  receiptUrl?: string;
  draftAttempts: number;
  /** A draft run is open for this show (M2). */
  openRun?: boolean;
  /** The open draft run's id, for the "Watch it work" link. */
  openRunId?: string;
  audioOnDisk?: boolean;
  fetch?: { status: "fetching" | "fetched" | "failed"; error?: string };
  rerunOf?: string;
  rerunSource?: "chat" | "episodes" | "detected";
  /** Tarik's fix saved in Air Check (decision 017); `stale`: the scan could no longer apply it, so the show won't draft. */
  corrected?: { fields: CorrectedField[]; at: number; stale: boolean } | null;
  /** R4: a fix, undo or placement is saved but the scan that applies it hasn't landed yet. */
  rescanPending?: boolean;
};
export type EpisodeActions = {
  answer: (a: { showDate: string; questionId: string; answer: string; rerunOf?: string }) => Promise<unknown>;
  markRerun: (a: { showDate: string; rerunOf: string }) => Promise<unknown>;
  unmarkRerun: (a: { showDate: string }) => Promise<unknown>;
  /** R9: "Try again" on a draft-failed show; the scanner then queues fresh attempts. */
  retryDraft: (a: { showDate: string }) => Promise<unknown>;
  // Plan 6b: corrections. Each is a signed-in person's mutation; Convex refuses anything else in plain words.
  setTracklist: (a: { showDate: string; text: string }) => Promise<unknown>;
  pick: (a: { showDate: string; source: FixSource; id: string }) => Promise<unknown>;
  setHours: (a: { showDate: string; hour1: string; hour2: string }) => Promise<unknown>;
  useFolderDate: (a: { showDate: string }) => Promise<unknown>;
  clearCorrection: (a: { showDate: string }) => Promise<unknown>;
  place: (a: { source: FixSource; id: string; date: string }) => Promise<unknown>;
  unplace: (a: { source: FixSource; id: string }) => Promise<unknown>;
  /** The tracklist editor's starting text: the saved fix, else the Drive doc, else the stored tracks. */
  tracklistText: (showDate: string) => Promise<string>;
  // Plan 7: research from this show's tracklist (show notes) or its Paper notes (pre-air verify), then its page.
  startShowNotes?: (a: { showDate: string }) => Promise<{ jobId: string }>;
  startVerify?: (a: { showDate: string }) => Promise<{ jobId: string }>;
  openResearch?: (jobId: string) => void;
};

const SOURCE_SAID = { chat: "(you said, in Chat)", episodes: "(marked here)", detected: "(confirmed)" } as const;
export const LINK = "font-medium text-ink underline underline-offset-2 hover:text-signal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
export const SECONDARY = `${BTN} border-line-strong bg-surface text-ink hover:bg-surface-quiet disabled:opacity-60`;
export const PRIMARY = `${BTN} border-signal bg-signal text-white hover:bg-signal-deep disabled:opacity-60`;
export const FIELD = "min-h-11 rounded-control border border-line-strong bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal";

/** Only a ConvexError's own plain message is shown; anything else (a server crash, a network error) never leaks raw text. */
export function errorText(e: unknown): string {
  const message = e instanceof ConvexError ? (e.data as { message?: unknown } | null)?.message : undefined;
  return typeof message === "string" ? message : "That didn't save. Try again.";
}

/** One row's save: busy while it runs, the reason when it is refused, a line for screen readers when it lands. */
export function useSave(announce: (msg: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True when it saved. */
  const save = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      announce(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

function ShowPicker({ id, choices, value, onChange }: { id: string; choices: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-sm text-ink-soft">Rerun of</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        <option value="">Choose a show</option>
        {choices.map((d) => <option key={d} value={d}>{showDateLabel(d)}</option>)}
      </select>
    </span>
  );
}

export type RowCtx = { actions: EpisodeActions; announce: (msg: string) => void; choices: string[] };

export function AnswerBox({ showDate, q, ctx }: { showDate: string; q: Question; ctx: RowCtx }) {
  const [text, setText] = useState("");
  const [of, setOf] = useState("");
  const { busy, error, save } = useSave(ctx.announce);
  const date = showDateLabel(showDate);
  const id = `q-${showDate}-${q.id}`;
  const answer = (a: string, rerunOf?: string) =>
    save(() => ctx.actions.answer({ showDate, questionId: q.id, answer: a, ...(rerunOf && { rerunOf }) }), `Answer saved for ${date}`);

  if (q.kind === "rerun") {
    const known = q.rerunOf;
    return (
      <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
        <p id={id} className="font-medium">
          {known ? `Is ${date} a rerun of ${showDateLabel(known)}?` : `Is ${date} a rerun, and of which show?`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!known && <ShowPicker id={`${id}-of`} choices={ctx.choices} value={of} onChange={setOf} />}
          <button type="button" className={SECONDARY} disabled={busy || (!known && !of)} onClick={() => answer("Yes", known ? undefined : of)}>Yes, a rerun</button>
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => answer("No")}>No</button>
        </div>
        {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
      </div>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void answer(text.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium [overflow-wrap:anywhere]">{q.text}</label>
      <div className="flex flex-wrap gap-2">
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} className={`${FIELD} w-full min-w-0 flex-1 basis-64`} />
        <button type="submit" className={SECONDARY} disabled={busy || !text.trim()}>Save answer</button>
      </div>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </form>
  );
}

export function RerunLine({ e, ctx }: { e: EpisodeRow; ctx: RowCtx }) {
  const { busy, error, save } = useSave(ctx.announce);
  const of = e.rerunOf!;
  const source = e.rerunSource ?? "episodes";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p>
          {/* I2: a pre-2026 original has no row on this page to link to. */}
          Rerun of {of < "2026-01-01" ? showDateLabel(of) : <a href={`#ep-${of}`} className={LINK}>{showDateLabel(of)}</a>} {SOURCE_SAID[source]}. Not drafted or posted.
        </p>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => save(() => ctx.actions.unmarkRerun({ showDate: e.showDate }), `${showDateLabel(e.showDate)} is back in the backlog`)}>
          {source === "detected" ? "Undo: not a rerun" : "Undo"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </div>
  );
}

/** R9: a show the agent couldn't draft twice: Try again (two fresh attempts), or fix the tracklist below. */
export function DraftFailedLine({ showDate, ctx }: { showDate: string; ctx: RowCtx }) {
  const { busy, error, save } = useSave(ctx.announce);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p>The agent couldn&apos;t draft this show twice. Try again, or check the tracklist.</p>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => save(() => ctx.actions.retryDraft({ showDate }), `Trying ${showDateLabel(showDate)} again`)}>
          Try again
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </div>
  );
}

export function MarkForm({ showDate, ctx, onClose }: { showDate: string; ctx: RowCtx; onClose: () => void }) {
  const [of, setOf] = useState("");
  const { busy, error, save } = useSave(ctx.announce);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    // Closed once saved, so an Undo later does not bring the form back open.
    if (of && (await save(() => ctx.actions.markRerun({ showDate, rerunOf: of }), `${showDateLabel(showDate)} marked as a rerun of ${showDateLabel(of)}`))) onClose();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ShowPicker id={`mark-${showDate}`} choices={ctx.choices} value={of} onChange={setOf} />
        <button type="submit" className={PRIMARY} disabled={busy || !of}>Save</button>
        <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
      </div>
      <p className="text-sm text-muted">A rerun is never drafted, downloaded or posted. Undo puts it back.</p>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </form>
  );
}

export function AudioAsk({ showDate }: { showDate: string }) {
  return (
    <div className="text-sm">
      <p>
        Audio folder unclear — copy the two hour files to the inbox by hand, then draft it from the{" "}
        <Link href="/tracklist" className={LINK}>Tracklist page</Link>.
      </p>
      <details className="mt-1 text-ink-soft">
        <summary className="w-fit cursor-pointer font-medium text-ink underline underline-offset-2">How</summary>
        <p className="mt-1 max-w-[65ch]">
          On the server, put the show's two hour WAVs in <span className="font-mono text-[12.5px]">~/aircheck-audio/inbox/{showDate}/</span>, named{" "}
          <span className="font-mono text-[12.5px]">1-hour.wav</span> and <span className="font-mono text-[12.5px]">2-hour.wav</span>. The media service makes the MP3 from
          there. Steps: docs/DEPLOY.md, &ldquo;The media service&rdquo;.
        </p>
      </details>
    </div>
  );
}

/** Plan 7: "Show notes" on a row with a tracklist, "Pre-air verify" on a row with Paper notes. Each opens the job's page. */
export function ResearchButtons({ e, ctx, className }: { e: EpisodeRow; ctx: RowCtx; className: string }) {
  const { busy, error, save } = useSave(ctx.announce);
  const { startShowNotes, startVerify, openResearch } = ctx.actions;
  if (!openResearch || e.status === "rerun") return null;
  const start = (fn: (a: { showDate: string }) => Promise<{ jobId: string }>, what: string) =>
    save(async () => openResearch((await fn({ showDate: e.showDate })).jobId), `${what} started for ${showDateLabel(e.showDate)}`);
  return (
    <>
      {startShowNotes && e.tracklist.status === "found" && (
        <button type="button" className={className} disabled={busy} onClick={() => start(startShowNotes, "Show notes")}>Show notes</button>
      )}
      {startVerify && e.notes.status === "found" && (
        <button type="button" className={className} disabled={busy} onClick={() => start(startVerify, "Pre-air verify")}>Pre-air verify</button>
      )}
      {error && <p role="alert" className="basis-full text-sm text-problem-text">{error}</p>}
    </>
  );
}
