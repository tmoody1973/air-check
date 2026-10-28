import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { blankFridays, summaryLine } from "../lib/episodes";
import type { EpisodeActions, EpisodeRow, RowCtx } from "./EpisodeControls";
import { COLUMN_SOURCE, EpisodeItem, type SourceStates } from "./EpisodeItem";
import type { Workspace } from "./Shell";
import type { SourceStatus } from "./SourceConnections";

export type { EpisodeActions, EpisodeRow };

// Plan 6 Task 5: the 2026 backlog, oldest first (the order it clears in, so the next show is at the top). Every
// count and blank Friday comes from the rows; nothing is invented. Notes text never reaches this page (Hard Rule 12).

const CONNECT_NOTE = { box: "Set up Box in Settings", google: "Connect Google in Settings", dropbox: "Connect Dropbox in Settings" } as const;
const RECONNECT = { box: "Fix the Box sign-in (ingest.env)", google: "Reconnect Google in Settings", dropbox: "Reconnect Dropbox in Settings" } as const;
const SOURCES = ["box", "google", "dropbox"] as const;
const COLUMNS = ["audio", "tracklist", "notes"] as const;
const th = "px-3 py-2.5 text-left align-top font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted";
const NOTE_LINK = "font-sans text-xs normal-case tracking-normal text-ink-soft underline underline-offset-2";

// R15: cards below Tailwind's md (768px), where the 720px table would scroll sideways. One layout is rendered, not
// both hidden by CSS, so ids, labels and the #ep-<date> links stay unique. No matchMedia (tests, server) = table.
const WIDE = "(min-width: 768px)";
const subscribe = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useWide = () => useSyncExternalStore(subscribe, () => !window.matchMedia || window.matchMedia(WIDE).matches, () => true);

export function EpisodesView({
  data,
  sources,
  workspace,
  today,
  actions,
  layout,
}: {
  /** episodes.list: undefined while loading, null for the demo or anyone not signed in as station staff. */
  data: { episodes: EpisodeRow[]; awaitingReview: number } | null | undefined;
  sources: SourceStatus[] | null | undefined;
  workspace: Workspace;
  /** Today's Chicago day key, for the blank Fridays. */
  today: string;
  actions: EpisodeActions;
  /** Forces a layout (tests, screenshots); otherwise the screen width picks. */
  layout?: "table" | "cards";
}) {
  // A save message with a counter: the same words twice still change the live region, so both are announced.
  const [said, setSaid] = useState({ text: "", n: 0 });
  const announce = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));
  const wide = useWide();
  if (workspace === "demo") return <p className="text-ink-soft">{"The demo doesn't include the backlog."}</p>;
  if (data === undefined) return <p className="text-ink-soft">Loading…</p>;
  if (data === null) return <p className="text-ink-soft">{"This account can't use Air Check. Sign in with your Radio Milwaukee account."}</p>;
  if (data.episodes.length === 0)
    return <p className="text-ink-soft">No shows found yet. The ingest service reads Box, Google Drive and Dropbox every hour.</p>;

  const cards = (layout ?? (wide ? "table" : "cards")) === "cards";
  // Loading or hidden sources say nothing; a source with no row yet is not connected (as on Settings).
  const states: SourceStates = sources ? Object.fromEntries(SOURCES.map((s) => [s, sources.find((r) => r.source === s)?.state ?? "not_connected"])) : {};
  const failing = SOURCES.filter((s) => states[s] === "needs_reconnect");
  const unconnected = Object.values(COLUMN_SOURCE).filter((s) => states[s] === "not_connected");
  const blanks = blankFridays(data.episodes.map((e) => e.showDate), today);
  const rows = [...data.episodes.map((e) => ({ date: e.showDate, e })), ...blanks.map((date) => ({ date, e: null }))].sort((a, b) => a.date.localeCompare(b.date));
  const ctxFor = (date: string): RowCtx => ({
    actions,
    announce,
    choices: data.episodes.filter((x) => x.status !== "rerun" && x.showDate < date).map((x) => x.showDate),
  });
  const items = rows.map(({ date, e }) => (
    <EpisodeItem key={date} e={e} showDate={date} sources={states} ctx={ctxFor(date)} layout={cards ? "card" : "row"} />
  ));
  const header = (label: string, column: keyof typeof COLUMN_SOURCE) => (
    <th scope="col" className={th}>
      {label}
      {states[COLUMN_SOURCE[column]] === "not_connected" && (
        <Link href="/settings" className={`mt-1 block ${NOTE_LINK}`}>{CONNECT_NOTE[COLUMN_SOURCE[column]]}</Link>
      )}
    </th>
  );

  return (
    <div className="mx-auto flex max-w-[1000px] min-w-0 flex-col gap-4">
      <p className="text-ink-soft">{summaryLine(data.episodes, blanks.length, COLUMNS.filter((c) => states[COLUMN_SOURCE[c]] === "not_connected"))}</p>
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
      {cards ? (
        <>
          {unconnected.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {unconnected.map((s) => <Link key={s} href="/settings" className={NOTE_LINK}>{CONNECT_NOTE[s]}</Link>)}
            </p>
          )}
          <ol aria-label="2026 shows, oldest first" className="flex flex-col gap-3">{items}</ol>
        </>
      ) : (
        <section aria-label="2026 shows" className="overflow-x-auto rounded-card border border-line bg-surface p-2">
          <table className="w-full min-w-[720px] border-collapse text-sm tabular-nums">
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
            {items}
          </table>
        </section>
      )}
      <p role="status" className="sr-only">{said.text}{said.n % 2 ? "\u00a0" : ""}</p>
    </div>
  );
}
