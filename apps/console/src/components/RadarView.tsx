"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { showDateLabel } from "../lib/date";
import { useWide } from "../lib/wide";
import { RadarNotAdded, type NotAddedRow } from "./RadarNotAdded";
import { ReleaseItem, type RadarActions, type RadarTab, type Release, type ReleaseCtx, type ReleaseStatus } from "./ReleaseItem";
import { SampleTag } from "./SampleTag";
import type { Workspace } from "./Shell";

// Plan 8 Task 6: the Release radar. Two real tabs (Bandcamp, Co-signs), status chips, grouping (PRD job 6), each record
// as a table row on a wide screen or a card on a phone, and the "Not added" list below both tabs (real workspace only).
// This is a private, signed-in view (Hard Rule 10): embargoed releases and their players show here and nowhere public.
// Task 6b: one search box (the page runs it in Convex across artist, title, label, tags and about), a Favorites filter
// and a tag filter (set by a tag chip). Filters hold across both tabs.

export type RadarList = { rows: Release[]; counts: Record<ReleaseStatus, number> } | null | undefined;
export type RadarLists = Record<RadarTab, RadarList>;
type Filter = ReleaseStatus | "all";
type GroupBy = "label" | "genre" | "date";

const TABS: { tab: RadarTab; label: string }[] = [
  { tab: "bandcamp", label: "Bandcamp" },
  { tab: "cosign", label: "Co-signs" },
];
const FILTERS: { f: Filter; label: string; empty: string }[] = [
  { f: "new", label: "New", empty: "Nothing new on this tab." },
  { f: "considering", label: "Considering", empty: "Nothing you're considering on this tab." },
  { f: "played", label: "Played", empty: "Nothing played from this tab yet." },
  { f: "passed", label: "Passed", empty: "Nothing passed on this tab." },
  { f: "all", label: "All", empty: "" },
];
const GROUPS: Record<RadarTab, { by: GroupBy; label: string }[]> = {
  bandcamp: [{ by: "label", label: "Label" }, { by: "genre", label: "Genre" }, { by: "date", label: "Release date" }],
  cosign: [{ by: "label", label: "Label" }, { by: "date", label: "Release date" }],
};
const EMPTY_TAB: Record<RadarTab, string> = {
  bandcamp: "Nothing yet. Bandcamp's new-release emails land here once your Gmail filter forwards them to the Air Check inbox.",
  cosign: "Nothing yet. Forward a label or PR email to the Air Check inbox and it lands here as one record.",
};
const NOT_KNOWN: Record<GroupBy, string> = { label: "[No label]", genre: "[No genre]", date: "[Date not known]" };
const th = "px-3 py-2.5 text-left align-top font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted";

type Group = { key: string; label: string; rows: Release[] };

/** Groups in reading order: names A to Z, dates soonest first, and the bracketed "not known" group last. */
function groupsOf(rows: Release[], by: GroupBy): Group[] {
  const keyOf = (r: Release) => (by === "date" ? r.releasedOn : by === "label" ? r.label?.trim() : r.genre?.trim()) || "";
  const groups = new Map<string, Release[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  return [...groups.entries()]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : by === "date" ? a.localeCompare(b) : a.localeCompare(b, "en", { sensitivity: "base" })))
    .map(([key, rows]) => ({ key, rows, label: !key ? NOT_KNOWN[by] : by === "date" ? showDateLabel(key) : key }));
}

function Tabs({ tab, lists, onTabChange }: { tab: RadarTab; lists: RadarLists; onTabChange: (t: RadarTab) => void }) {
  const refs = useRef<Partial<Record<RadarTab, HTMLButtonElement | null>>>({});
  const go = (t: RadarTab) => {
    onTabChange(t);
    refs.current[t]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = TABS.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    go(TABS[to]!.tab);
  };
  return (
    <div role="tablist" aria-label="Release radar" className="flex gap-1 border-b border-line">
      {TABS.map(({ tab: t, label }, i) => {
        const on = t === tab;
        const n = lists[t]?.counts.new;
        return (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            id={`radar-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls="radar-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => go(t)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
              on ? "border-signal font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            <span>{label}</span>
            {n !== undefined && <span className={`font-mono text-[11px] tracking-[0.05em] ${on ? "text-signal" : "text-muted"}`}>{n} new</span>}
          </button>
        );
      })}
    </div>
  );
}

export function RadarView({
  lists,
  tab,
  onTabChange,
  workspace,
  today,
  actions,
  notAdded,
  layout,
  search,
  onSearchChange,
}: {
  lists: RadarLists;
  tab: RadarTab;
  onTabChange: (t: RadarTab) => void;
  workspace: Workspace;
  today: string;
  actions: RadarActions;
  notAdded: NotAddedRow[] | undefined;
  /** Tests pick one; the page follows the screen width. */
  layout?: "table" | "cards";
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("new");
  const [favorites, setFavorites] = useState(false);
  const [tag, setTag] = useState<string | undefined>();
  const [group, setGroup] = useState<GroupBy>("label");
  // A save message with a counter: the same words twice still change the live region, so both are announced.
  const [said, setSaid] = useState({ text: "", n: 0 });
  const announce = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));
  const wide = useWide();

  if (lists.bandcamp === null || lists.cosign === null)
    return <p className="text-ink-soft">{"This account can't use Air Check. Sign in with your Radio Milwaukee account."}</p>;

  const demo = workspace === "demo";
  const cards = (layout ?? (wide ? "table" : "cards")) === "cards";
  const data = lists[tab];
  const by = GROUPS[tab].some((g) => g.by === group) ? group : "label";
  const ctx: ReleaseCtx = { actions, announce, today, demo, tab, tag, onTag: (t) => setTag((cur) => (cur === t ? undefined : t)) };
  const chipClass = (on: boolean) =>
    `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
      on ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:bg-surface-quiet"
    }`;

  const panel = () => {
    if (!data) return <p className="text-ink-soft">Loading…</p>;
    const total = data.rows.length;
    // Favorites and the tag narrow the tab; the status chips then count within what is left.
    const narrowed = data.rows.filter((r) => (!favorites || r.favorite) && (!tag || r.tags?.includes(tag)));
    const shown = filter === "all" ? narrowed : narrowed.filter((r) => r.status === filter);
    const groups = groupsOf(shown, by);
    const count = (f: Filter) => (f === "all" ? narrowed.length : narrowed.filter((r) => r.status === f).length);
    const favoriteCount = data.rows.filter((r) => r.favorite && (!tag || r.tags?.includes(tag))).length;
    const searching = search.trim() !== "";
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div role="group" aria-label="Filters" className="flex flex-wrap gap-2">
          <div role="group" aria-label="Status" className="contents">
            {FILTERS.map(({ f, label }) => {
              const on = f === filter;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f)}
                  className={chipClass(on)}
                >
                  {label} <b className="font-semibold tabular-nums">{count(f)}</b>
                </button>
              );
            })}
          </div>
            <button type="button" aria-pressed={favorites} onClick={() => setFavorites(!favorites)} className={chipClass(favorites)}>
              <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 2.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" fill={favorites ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              Favorites <b className="font-semibold tabular-nums">{favoriteCount}</b>
            </button>
          </div>
          <span className="flex items-center gap-2">
            <label htmlFor="radar-group" className="text-sm text-ink-soft">Group by</label>
            <select id="radar-group" value={by} onChange={(e) => setGroup(e.target.value as GroupBy)} className="min-h-11 rounded-control border border-line-strong bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal">
              {GROUPS[tab].map((g) => <option key={g.by} value={g.by}>{g.label}</option>)}
            </select>
          </span>
        </div>
        {tag && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-ink px-3 py-1 text-xs text-paper [overflow-wrap:anywhere]">Tag: {tag}</span>
            <button type="button" onClick={() => setTag(undefined)} className="min-h-11 rounded-control px-2 font-medium text-ink underline underline-offset-2 hover:text-signal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal">
              Clear tag
            </button>
          </p>
        )}
        {total === 0 ? (
          <p className="max-w-[65ch] text-sm text-muted [overflow-wrap:anywhere]">{searching ? `Nothing on this tab matches “${search.trim()}”.` : EMPTY_TAB[tab]}</p>
        ) : narrowed.length === 0 ? (
          <p className="text-sm text-muted">Nothing matches these filters.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted">{FILTERS.find((x) => x.f === filter)!.empty}</p>
        ) : cards ? (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label} className="flex flex-col gap-2">
                <h3 className="flex items-baseline gap-2 text-sm font-semibold [overflow-wrap:anywhere]">
                  {g.label}
                  <span className="font-mono text-[11px] font-normal text-muted">{g.rows.length}</span>
                </h3>
                <ol className="flex flex-col gap-3">{g.rows.map((r) => <ReleaseItem key={r._id} r={r} layout="card" ctx={ctx} />)}</ol>
              </section>
            ))}
          </div>
        ) : (
          <section aria-label="Releases" className="overflow-x-auto rounded-card border border-line bg-surface p-2">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only">Releases, grouped by {GROUPS[tab].find((g) => g.by === by)!.label.toLowerCase()}, newest email first in each group.</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${th} w-[34%]`}>Release</th>
                  <th scope="col" className={th}>{tab === "cosign" ? "From" : "Label"}</th>
                  <th scope="col" className={th}>{tab === "cosign" ? "Label · type" : "Genre · type"}</th>
                  <th scope="col" className={th}>Released</th>
                  <th scope="col" className={th}>Status</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  <tr>
                    <th scope="rowgroup" colSpan={5} className="border-t border-line-strong px-3 pb-1 pt-4 text-left text-sm font-semibold">
                      {g.label}
                      <span className="ml-2 font-mono text-[11px] font-normal text-muted">{g.rows.length}</span>
                    </th>
                  </tr>
                  {g.rows.map((r) => <ReleaseItem key={r._id} r={r} layout="row" ctx={ctx} />)}
                </tbody>
              ))}
            </table>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto flex max-w-[1000px] min-w-0 flex-col gap-5">
      {demo && (
        <p className="flex items-center gap-3 text-sm text-ink-soft">
          Sample releases. No real music or players in the demo.
          <SampleTag />
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="radar-search" className="text-sm text-ink-soft">Search</label>
        <input
          id="radar-search"
          type="search"
          value={search}
          maxLength={200}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Artist, title, label, tag or description"
          className="min-h-11 w-full max-w-[480px] rounded-control border border-line-strong bg-surface px-3 text-[15px] placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Tabs tab={tab} lists={lists} onTabChange={onTabChange} />
        <div role="tabpanel" id="radar-panel" aria-labelledby={`radar-tab-${tab}`} tabIndex={0} className="min-w-0 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal">
          {panel()}
        </div>
      </div>
      {!demo && notAdded && <RadarNotAdded rows={notAdded} retry={actions.retry} announce={announce} />}
      <p role="status" className="sr-only">{said.text}{said.n % 2 ? " " : ""}</p>
    </div>
  );
}
