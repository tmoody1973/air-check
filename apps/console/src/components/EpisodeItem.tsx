import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { showDateLabel } from "../lib/date";
import { fetchErrorText } from "../lib/episodes";
import { AnswerBox, AudioAsk, LINK, MarkForm, RerunLine, type EpisodeRow, type Question, type RowCtx } from "./EpisodeControls";
import { CorrectedLine, FixControl, hasAudioFix, withoutHandCopy } from "./FixControl";
import { Pill, type PillTone } from "./Pill";
import { isMixcloudUrl } from "./PublishStatus";
import { TracklistFix } from "./TracklistFix";
import type { SourceStatus } from "./SourceConnections";

// One show (or one blank Friday) as one model, drawn two ways: a row group in the table on wide screens, a stacked card
// on a phone (R15: Tarik answers questions from his iPhone, so nothing there may scroll sideways).

export type Layout = "row" | "card";
export type SourceStates = Partial<Record<"box" | "google" | "dropbox", SourceStatus["state"]>>;

const STATUS: Record<string, [PillTone, string]> = {
  "missing-audio": ["caution", "No audio"],
  "missing-tracklist": ["caution", "No tracklist"],
  question: ["caution", "Question for you"],
  "ready-to-draft": ["neutral", "Waiting to draft"],
  // Core's "drafting" is a package waiting for its MP3 (M2); a draft run with no package yet is DRAFTING below.
  drafting: ["neutral", "Preparing audio"],
  "awaiting-review": ["ready", "Ready for review"],
  approved: ["ready", "Approved"],
  published: ["ready", "Published"],
  failed: ["problem", "Upload failed"],
  "outcome-unknown": ["problem", "Upload unclear"],
  skipped: ["neutral", "Skipped"],
  rerun: ["neutral", "Rerun"],
  "draft-failed": ["problem", "Draft failed"],
};
const DRAFTING: [PillTone, string] = ["neutral", "Drafting"];
/** Plan 6b: before a package, a fix waiting for its scan or a stale fix holds the draft, so the pill says so (not "Waiting to draft"). */
function fixState(e: EpisodeRow): [PillTone, string] | null {
  if (e.packageStatus !== "none" || e.status === "rerun") return null;
  if (e.rescanPending) return ["neutral", "Checking your fix"];
  return e.corrected?.stale ? ["problem", "Fix needs a look"] : null;
}
/** Before a package exists, a week can still be declared a rerun (R7); not while a draft run is open (M2). */
const MARKABLE = new Set(["missing-audio", "missing-tracklist", "question", "ready-to-draft", "draft-failed"]);
export const COLUMN_SOURCE = { audio: "box", tracklist: "google", notes: "dropbox" } as const;

const GOOD = "text-signal-deep";
const WARN = "text-caution-text";
const BAD = "text-problem-text";
/** A word in a colour, or a neutral dash with its reason for screen readers (R13: not connected; a rerun: not needed). */
type Value = { text: string; cls: string } | { dash: "Not connected" | "Not needed" };

function audioValue(e: EpisodeRow): Value {
  if (e.fetch?.status === "fetching") return { text: "Downloading", cls: WARN };
  if (e.fetch?.status === "failed") return { text: "Download failed", cls: BAD };
  if (e.audioOnDisk) return { text: "On disk", cls: GOOD };
  const [text, cls] = ({ ready: ["In Box", GOOD], incomplete: ["One hour missing", WARN], ask: ["Unclear", WARN], none: ["Missing", BAD] } as const)[e.audio.status];
  return { text, cls };
}
const found = (s: "found" | "missing"): Value => (s === "found" ? { text: "Found", cls: GOOD } : { text: "Missing", cls: BAD });

function cellsOf(e: EpisodeRow, sources: SourceStates): [label: string, value: Value][] {
  const shown = (column: keyof typeof COLUMN_SOURCE, v: Value): Value =>
    e.status === "rerun" ? { dash: "Not needed" } : sources[COLUMN_SOURCE[column]] === "not_connected" ? { dash: "Not connected" } : v;
  return [
    ["Audio", shown("audio", audioValue(e))],
    ["Tracklist", shown("tracklist", found(e.tracklist.status))],
    ["Notes", shown("notes", found(e.notes.status))],
  ];
}

const ValueText = ({ value }: { value: Value }) =>
  "dash" in value ? (
    <span className="text-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{value.dash}</span>
    </span>
  ) : (
    <span className={value.cls}>{value.text}</span>
  );

function statusLink(e: EpisodeRow): ReactNode {
  if (e.status === "published" && isMixcloudUrl(e.receiptUrl))
    return <a href={e.receiptUrl} target="_blank" rel="noreferrer" className={LINK}>On Mixcloud</a>;
  return e.packageStatus !== "none" ? <Link href={`/packages/${e.packageId}`} className={LINK}>Open package</Link> : null;
}

/** One question: its words, then the answer box or the "fix it in the source" line, then any in-console fix (Plan 6b). */
function QuestionItem({ e, q, ctx, onEditTracklist }: { e: EpisodeRow; q: Question; ctx: RowCtx; onEditTracklist: () => void }) {
  const fix = q.fix && <FixControl showDate={e.showDate} fix={q.fix} ctx={ctx} onEditTracklist={onEditTracklist} />;
  const said = (line: ReactNode) => (
    <p className="flex flex-col [overflow-wrap:anywhere]">
      <span className="font-medium">{q.fix?.type === "hours" ? withoutHandCopy(q.text) : q.text}</span>
      {line && <span className="text-ink-soft">{line}</span>}
    </p>
  );
  // M6: an action question is settled by a fix (in the source, or now here), so it has no answer box. The hours
  // picker replaces the special folder's answer box: the answer to "which files?" is the two files.
  const head = q.action
    ? said("This clears on the next scan after you fix it.")
    : q.answer
      ? said(`You answered: ${q.answer}`)
      : q.fix?.type === "hours"
        ? said(null)
        : <AnswerBox showDate={e.showDate} q={q} ctx={ctx} />;
  return (
    <div className="flex flex-col gap-2">
      {head}
      {fix}
    </div>
  );
}

/** The explanations and controls under a show, in reading order. */
function detailsOf(e: EpisodeRow, ctx: RowCtx, canChange: boolean, onEditTracklist: () => void): ReactNode[] {
  const parts: ReactNode[] = [];
  if (e.status === "rerun" && e.rerunOf) parts.push(<RerunLine key="rerun" e={e} ctx={ctx} />);
  if (e.corrected || e.rescanPending) parts.push(<CorrectedLine key="corrected" e={e} ctx={ctx} canChange={canChange} />);
  if (e.status === "draft-failed")
    parts.push(
      <p key="draft">
        {"The agent couldn't draft this show twice"} — <Link href="/chat" className={LINK}>open Chat</Link> to try, or check the tracklist.
      </p>,
    );
  if (e.audio.status === "ask" && e.status !== "rerun" && !hasAudioFix(e.questions)) parts.push(<AudioAsk key="ask" showDate={e.showDate} />);
  if (e.fetch?.status === "failed") parts.push(<p key="fetch" className="text-problem-text">Download failed ({fetchErrorText(e.fetch.error)})</p>);
  for (const q of e.questions) parts.push(<QuestionItem key={q.id} e={e} q={q} ctx={ctx} onEditTracklist={onEditTracklist} />);
  return parts;
}

const ROW_ACTION = "min-h-11 text-sm text-ink-soft underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-signal";
const RowAction = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className={ROW_ACTION}>{children}</button>
);

const td = "border-t border-line px-3 py-2 align-middle";
const BLANK = "No show folder or tracklist found";

/** A show (`e`) or a blank Friday (`e` null) at `showDate`. */
export function EpisodeItem({ e, showDate, sources, ctx, layout }: { e: EpisodeRow | null; showDate: string; sources: SourceStates; ctx: RowCtx; layout: Layout }) {
  const [marking, setMarking] = useState(false);
  const [editing, setEditing] = useState(false);
  const canMark = (e ? MARKABLE.has(e.status) && !e.openRun : true) && ctx.choices.length > 0;
  const [tone, word] = !e ? (["neutral", "Blank Friday"] as const) : e.openRun && e.packageStatus === "none" ? DRAFTING : (fixState(e) ?? STATUS[e.status] ?? ["neutral", e.status]);
  const cells = e && cellsOf(e, sources);
  const link = e && statusLink(e);
  const onMark = canMark && !marking ? () => setMarking(true) : undefined;
  // Plan 6b: a show is fixed here until it has a package or an open run (then it is frozen: the package page).
  const canChange = !!e && e.packageStatus === "none" && !e.openRun;
  const canEdit = canChange && e.status !== "rerun";
  const onEdit = canEdit && !editing ? () => setEditing(true) : undefined;
  const details = e ? detailsOf(e, ctx, canChange, () => setEditing(true)) : [];
  if (editing && canEdit) details.push(<TracklistFix key="edit" showDate={showDate} ctx={ctx} onClose={() => setEditing(false)} />);
  if (marking && canMark) details.push(<MarkForm key="mark" showDate={showDate} ctx={ctx} onClose={() => setMarking(false)} />);
  const date = showDateLabel(showDate);
  const id = `ep-${showDate}`;

  if (layout === "card")
    return (
      <li id={id} className="scroll-mt-6 rounded-card border border-line bg-surface p-4 target:border-signal">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={`font-medium ${e ? "" : "text-ink-soft"}`}>{date}</h2>
          <Pill tone={tone}>{word}</Pill>
        </div>
        {cells ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
            {cells.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">{label}</dt>
                <dd><ValueText value={value} /></dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">{BLANK}</p>
        )}
        {(link || onEdit || onMark) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4">
            {link}
            {onEdit && <RowAction onClick={onEdit}>Edit tracklist</RowAction>}
            {onMark && <RowAction onClick={onMark}>Mark as rerun of…</RowAction>}
          </div>
        )}
        {details.length > 0 && <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 text-sm">{details}</div>}
      </li>
    );

  return (
    <tbody id={id} className="scroll-mt-6 target:[&>tr>*]:bg-signal-soft/50">
      <tr>
        <th scope="row" className={`${td} text-left font-medium whitespace-nowrap ${e ? "" : "text-ink-soft"}`}>{date}</th>
        {cells ? (
          cells.map(([label, value]) => <td key={label} className={td}><ValueText value={value} /></td>)
        ) : (
          <td colSpan={3} className={`${td} text-muted`}>{BLANK}</td>
        )}
        <td className={td}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill tone={tone}>{word}</Pill>
            {link}
            {onEdit && <RowAction onClick={onEdit}>Edit tracklist</RowAction>}
            {onMark && <RowAction onClick={onMark}>Mark as rerun of…</RowAction>}
          </div>
        </td>
      </tr>
      {details.length > 0 && (
        <tr>
          <td colSpan={5} className="px-3 pb-4 pt-0">
            <div className="flex flex-col gap-3 rounded-control bg-surface-quiet px-4 py-3 text-sm">{details}</div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
