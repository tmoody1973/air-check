import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { showDateLabel } from "../lib/date";
import { blankFridays, fetchErrorText, summaryLine } from "../lib/episodes";
import { BTN } from "./MixcloudConnection";
import { Pill, type PillTone } from "./Pill";
import { isMixcloudUrl } from "./PublishStatus";
import type { Workspace } from "./Shell";
import type { SourceStatus } from "./SourceConnections";

// Plan 6 Task 5: the 2026 backlog, oldest first (the order it clears in, so the next show is at the top). Every
// count and blank Friday comes from the rows; nothing is invented. Notes text never reaches this page (Hard Rule 12).

type Question = { id: string; text: string; kind: "audio" | "date" | "tracklist" | "rerun"; rerunOf?: string; answer?: string };
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
  audioOnDisk?: boolean;
  fetch?: { status: "fetching" | "fetched" | "failed"; error?: string };
  rerunOf?: string;
  rerunSource?: "chat" | "episodes" | "detected";
};
export type EpisodeActions = {
  answer: (a: { showDate: string; questionId: string; answer: string; rerunOf?: string }) => Promise<unknown>;
  markRerun: (a: { showDate: string; rerunOf: string }) => Promise<unknown>;
  unmarkRerun: (a: { showDate: string }) => Promise<unknown>;
};

const STATUS: Record<string, [PillTone, string]> = {
  "missing-audio": ["caution", "No audio"],
  "missing-tracklist": ["caution", "No tracklist"],
  question: ["caution", "Question for you"],
  "ready-to-draft": ["neutral", "Waiting to draft"],
  drafting: ["neutral", "Drafting"],
  "awaiting-review": ["ready", "Ready for review"],
  approved: ["ready", "Approved"],
  published: ["ready", "Published"],
  failed: ["problem", "Upload failed"],
  "outcome-unknown": ["problem", "Upload unclear"],
  skipped: ["neutral", "Skipped"],
  rerun: ["neutral", "Rerun"],
  "draft-failed": ["problem", "Draft failed"],
};
/** Before a package exists, a week can still be declared a rerun (R7). */
const MARKABLE = new Set(["missing-audio", "missing-tracklist", "question", "ready-to-draft", "draft-failed"]);
const SOURCE_SAID = { chat: "(you said, in Chat)", episodes: "(marked here)", detected: "(confirmed)" } as const;
const COLUMN_SOURCE = { audio: "box", tracklist: "google", notes: "dropbox" } as const;
const CONNECT_NOTE = { box: "Set up Box in Settings", google: "Connect Google in Settings", dropbox: "Connect Dropbox in Settings" } as const;
const RECONNECT = { box: "Fix the Box sign-in (ingest.env)", google: "Reconnect Google in Settings", dropbox: "Reconnect Dropbox in Settings" } as const;

const th = "px-3 py-2.5 text-left align-top font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted";
const td = "border-t border-line px-3 py-2 align-middle";
const LINK = "font-medium text-ink underline underline-offset-2 hover:text-signal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const SECONDARY = `${BTN} border-line-strong bg-surface text-ink hover:bg-surface-quiet disabled:opacity-60`;
const PRIMARY = `${BTN} border-signal bg-signal text-white hover:bg-signal-deep disabled:opacity-60`;
const FIELD = "min-h-11 rounded-control border border-line-strong bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal";

const errorText = (e: unknown) =>
  (e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : "That didn't save. Try again.");

/** One row's save: busy while it runs, the reason when it is refused, a line for screen readers when it lands. */
function useSave(announce: (msg: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      announce(done);
    } catch (e) {
      setError(errorText(e));
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

type RowCtx = { actions: EpisodeActions; announce: (msg: string) => void; choices: string[] };

function AnswerBox({ showDate, q, ctx }: { showDate: string; q: Question; ctx: RowCtx }) {
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
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} className={`${FIELD} min-w-0 flex-1 basis-64`} />
        <button type="submit" className={SECONDARY} disabled={busy || !text.trim()}>Save answer</button>
      </div>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </form>
  );
}

function RerunLine({ e, ctx }: { e: EpisodeRow; ctx: RowCtx }) {
  const { busy, error, save } = useSave(ctx.announce);
  const of = e.rerunOf!;
  const source = e.rerunSource ?? "episodes";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p>
          Rerun of <a href={`#ep-${of}`} className={LINK}>{showDateLabel(of)}</a> {SOURCE_SAID[source]}. Not drafted or posted.
        </p>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => save(() => ctx.actions.unmarkRerun({ showDate: e.showDate }), `${showDateLabel(e.showDate)} is back in the backlog`)}>
          {source === "detected" ? "Undo: not a rerun" : "Undo"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </div>
  );
}

function MarkForm({ showDate, ctx, onClose }: { showDate: string; ctx: RowCtx; onClose: () => void }) {
  const [of, setOf] = useState("");
  const { busy, error, save } = useSave(ctx.announce);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (of) await save(() => ctx.actions.markRerun({ showDate, rerunOf: of }), `${showDateLabel(showDate)} marked as a rerun of ${showDateLabel(of)}`);
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

function AudioAsk({ showDate }: { showDate: string }) {
  return (
    <div className="text-sm">
      <p>Audio folder unclear — copy the two hour files to the inbox by hand.</p>
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

type SourceStates = Partial<Record<"box" | "google" | "dropbox", SourceStatus["state"]>>;

function Cell({ column, value, sources }: { column: keyof typeof COLUMN_SOURCE; value: [string, string]; sources: SourceStates }) {
  if (sources[COLUMN_SOURCE[column]] === "not_connected")
    return (
      <td className={`${td} text-muted`}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not connected</span>
      </td>
    );
  return <td className={`${td} ${value[1]}`}>{value[0]}</td>;
}

const GOOD = "text-signal-deep";
const WARN = "text-caution-text";
const BAD = "text-problem-text";
function audioCell(e: EpisodeRow): [string, string] {
  if (e.fetch?.status === "fetching") return ["Downloading", WARN];
  if (e.fetch?.status === "failed") return ["Download failed", BAD];
  if (e.audioOnDisk) return ["On disk", GOOD];
  return ({ ready: ["In Box", GOOD], incomplete: ["One hour missing", WARN], ask: ["Unclear", WARN], none: ["Missing", BAD] } as const)[e.audio.status] as [string, string];
}
const found = (s: "found" | "missing"): [string, string] => (s === "found" ? ["Found", GOOD] : ["Missing", BAD]);

function StatusCell({ e, onMark }: { e: EpisodeRow; onMark?: () => void }) {
  const [tone, word] = STATUS[e.status] ?? ["neutral", e.status];
  const link =
    e.status === "published" && isMixcloudUrl(e.receiptUrl) ? (
      <a href={e.receiptUrl} target="_blank" rel="noreferrer" className={LINK}>On Mixcloud</a>
    ) : e.packageStatus !== "none" ? (
      <Link href={`/packages/${e.packageId}`} className={LINK}>Open package</Link>
    ) : null;
  return (
    <td className={td}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill tone={tone}>{word}</Pill>
        {link}
        {onMark && <MarkButton onClick={onMark} />}
      </div>
    </td>
  );
}
const MarkButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="min-h-11 text-sm text-ink-soft underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-signal">
    Mark as rerun of…
  </button>
);

const Detail = ({ children }: { children: ReactNode }) => (
  <tr>
    <td colSpan={5} className="px-3 pb-4 pt-0">
      <div className="flex flex-col gap-3 rounded-control bg-surface-quiet px-4 py-3 text-sm">{children}</div>
    </td>
  </tr>
);
const GROUP = "scroll-mt-6 target:[&>tr>*]:bg-signal-soft/50";

function ShowRows({ e, sources, ctx }: { e: EpisodeRow; sources: SourceStates; ctx: RowCtx }) {
  const [marking, setMarking] = useState(false);
  const canMark = MARKABLE.has(e.status) && ctx.choices.length > 0;
  const date = showDateLabel(e.showDate);
  const parts: ReactNode[] = [];
  if (e.status === "rerun" && e.rerunOf) parts.push(<RerunLine key="rerun" e={e} ctx={ctx} />);
  if (e.status === "draft-failed")
    parts.push(
      <p key="draft">
        {"The agent couldn't draft this show twice"} — <Link href="/chat" className={LINK}>open Chat</Link> to try, or check the tracklist.
      </p>,
    );
  if (e.audio.status === "ask" && e.status !== "rerun") parts.push(<AudioAsk key="ask" showDate={e.showDate} />);
  if (e.fetch?.status === "failed") parts.push(<p key="fetch" className="text-problem-text">Download failed ({fetchErrorText(e.fetch.error)})</p>);
  for (const q of e.questions)
    parts.push(
      q.answer ? (
        <p key={q.id} className="flex flex-col [overflow-wrap:anywhere]">
          <span className="font-medium">{q.text}</span>
          <span className="text-ink-soft">You answered: {q.answer}</span>
        </p>
      ) : (
        <AnswerBox key={q.id} showDate={e.showDate} q={q} ctx={ctx} />
      ),
    );
  if (marking && canMark) parts.push(<MarkForm key="mark" showDate={e.showDate} ctx={ctx} onClose={() => setMarking(false)} />);
  return (
    <tbody id={`ep-${e.showDate}`} className={GROUP}>
      <tr>
        <th scope="row" className={`${td} text-left font-medium whitespace-nowrap`}>{date}</th>
        <Cell column="audio" value={audioCell(e)} sources={sources} />
        <Cell column="tracklist" value={found(e.tracklist.status)} sources={sources} />
        <Cell column="notes" value={found(e.notes.status)} sources={sources} />
        <StatusCell e={e} onMark={canMark && !marking ? () => setMarking(true) : undefined} />
      </tr>
      {parts.length > 0 && <Detail>{parts}</Detail>}
    </tbody>
  );
}

function BlankRows({ showDate, ctx }: { showDate: string; ctx: RowCtx }) {
  const [marking, setMarking] = useState(false);
  return (
    <tbody id={`ep-${showDate}`} className={GROUP}>
      <tr>
        <th scope="row" className={`${td} text-left font-medium whitespace-nowrap text-ink-soft`}>{showDateLabel(showDate)}</th>
        <td colSpan={3} className={`${td} text-muted`}>No show folder or tracklist found</td>
        <td className={td}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill tone="neutral">Blank Friday</Pill>
            {ctx.choices.length > 0 && !marking && <MarkButton onClick={() => setMarking(true)} />}
          </div>
        </td>
      </tr>
      {marking && (
        <Detail>
          <MarkForm showDate={showDate} ctx={ctx} onClose={() => setMarking(false)} />
        </Detail>
      )}
    </tbody>
  );
}

export function EpisodesView({
  data,
  sources,
  workspace,
  today,
  actions,
}: {
  /** episodes.list: undefined while loading, null for the demo or anyone not signed in as station staff. */
  data: { episodes: EpisodeRow[]; awaitingReview: number } | null | undefined;
  sources: SourceStatus[] | null | undefined;
  workspace: Workspace;
  /** Today's Chicago day key, for the blank Fridays. */
  today: string;
  actions: EpisodeActions;
}) {
  const [said, setSaid] = useState("");
  if (workspace === "demo") return <p className="text-ink-soft">{"The demo doesn't include the backlog."}</p>;
  if (data === undefined) return <p className="text-ink-soft">Loading…</p>;
  if (data === null) return <p className="text-ink-soft">{"This account can't use Air Check. Sign in with your Radio Milwaukee account."}</p>;
  if (data.episodes.length === 0)
    return <p className="text-ink-soft">No shows found yet. The ingest service reads Box, Google Drive and Dropbox every hour.</p>;

  // Loading or hidden sources say nothing; a source with no row yet is not connected (as on Settings).
  const states: SourceStates = sources ? Object.fromEntries((["box", "google", "dropbox"] as const).map((s) => [s, sources.find((r) => r.source === s)?.state ?? "not_connected"])) : {};
  const failing = (["box", "google", "dropbox"] as const).filter((s) => states[s] === "needs_reconnect");
  const blanks = blankFridays(data.episodes.map((e) => e.showDate), today);
  const rows = [...data.episodes.map((e) => ({ date: e.showDate, e })), ...blanks.map((date) => ({ date, e: null }))].sort((a, b) => a.date.localeCompare(b.date));
  const ctxFor = (date: string): RowCtx => ({
    actions,
    announce: setSaid,
    choices: data.episodes.filter((x) => x.status !== "rerun" && x.showDate < date).map((x) => x.showDate),
  });
  const header = (label: string, column: keyof typeof COLUMN_SOURCE) => {
    const src = COLUMN_SOURCE[column];
    return (
      <th scope="col" className={th}>
        {label}
        {states[src] === "not_connected" && (
          <Link href="/settings" className="mt-1 block font-sans text-xs normal-case tracking-normal text-ink-soft underline underline-offset-2">
            {CONNECT_NOTE[src]}
          </Link>
        )}
      </th>
    );
  };

  return (
    <div className="mx-auto flex max-w-[1000px] min-w-0 flex-col gap-4">
      <p className="text-ink-soft">{summaryLine(data.episodes, blanks.length)}</p>
      {failing.length > 0 && (
        <p className="rounded-control bg-problem-bg px-4 py-3 text-sm text-problem-text">
          {failing.map((s, i) => (
            <span key={s}>
              {i > 0 && ", "}
              <Link href="/settings" className="font-medium underline underline-offset-2">{RECONNECT[s]}</Link>
            </span>
          ))}
          {" — drafting is paused."}
        </p>
      )}
      <section aria-label="2026 shows" className="overflow-x-auto rounded-card border border-line bg-surface p-2">
        <table className="w-full min-w-[760px] border-collapse text-sm tabular-nums">
          <caption className="sr-only">2026 shows, oldest first. The oldest unfinished show is drafted next.</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>Show</th>
              {header("Audio", "audio")}
              {header("Tracklist", "tracklist")}
              {header("Notes", "notes")}
              <th scope="col" className={th}>Status</th>
            </tr>
          </thead>
          {rows.map(({ date, e }) =>
            e ? <ShowRows key={date} e={e} sources={states} ctx={ctxFor(date)} /> : <BlankRows key={date} showDate={date} ctx={ctxFor(date)} />,
          )}
        </table>
      </section>
      <p role="status" className="sr-only">{said}</p>
    </div>
  );
}
