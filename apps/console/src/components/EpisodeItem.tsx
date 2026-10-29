import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { showDateLabel } from "../lib/date";
import { fetchErrorText } from "../lib/episodes";
import { AnswerBox, AudioAsk, LINK, MarkForm, RerunLine, type EpisodeRow, type RowCtx } from "./EpisodeControls";
import { Pill, type PillTone } from "./Pill";
import { isMixcloudUrl } from "./PublishStatus";
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

/** The explanations and controls under a show, in reading order. */
function detailsOf(e: EpisodeRow, ctx: RowCtx): ReactNode[] {
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
  return parts;
}

const MarkButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="min-h-11 text-sm text-ink-soft underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-signal">
    Mark as rerun of…
  </button>
);

const td = "border-t border-line px-3 py-2 align-middle";
const BLANK = "No show folder or tracklist found";

/** A show (`e`) or a blank Friday (`e` null) at `showDate`. */
export function EpisodeItem({ e, showDate, sources, ctx, layout }: { e: EpisodeRow | null; showDate: string; sources: SourceStates; ctx: RowCtx; layout: Layout }) {
  const [marking, setMarking] = useState(false);
  const canMark = (e ? MARKABLE.has(e.status) && !e.openRun : true) && ctx.choices.length > 0;
  const [tone, word] = !e ? (["neutral", "Blank Friday"] as const) : e.openRun && e.packageStatus === "none" ? DRAFTING : (STATUS[e.status] ?? ["neutral", e.status]);
  const cells = e && cellsOf(e, sources);
  const link = e && statusLink(e);
  const onMark = canMark && !marking ? () => setMarking(true) : undefined;
  const details = e ? detailsOf(e, ctx) : [];
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
        {(link || onMark) && <div className="mt-1 flex flex-wrap items-center gap-x-4">{link}{onMark && <MarkButton onClick={onMark} />}</div>}
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
            {onMark && <MarkButton onClick={onMark} />}
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
