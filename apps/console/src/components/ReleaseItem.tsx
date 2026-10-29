"use client";

import { bandcampArtUrl, isEmbargoActive, type BandcampEmbed } from "@aircheck/core";
import { useId, useState, type FormEvent } from "react";
import { chicagoDateLabel, showDateLabel } from "../lib/date";
import { BandcampPlayer } from "./BandcampPlayer";
import { FIELD, PRIMARY, SECONDARY, useSave } from "./EpisodeControls";
import { Pill, type PillTone } from "./Pill";
import { SampleTag } from "./SampleTag";

// Plan 8: one release record. Listening-queue brief D (Tarik's layout): one compact block, the same order on a phone and
// at a desk, built for triage (listen ~20 s, then Consider or Pass):
//   [art] Title ☆ / Artist · Label / (co-signs: From sender) / type · Out · received · tags (embargo pill)
//   [Play] [Consider] [Pass]  More
// Play opens Bandcamp's sandboxed player under the block (the list keeps one open at a time). More holds the rest:
// Played, Edit, the embargo controls, every tag, About and the links. Each action calls an injected Convex mutation as
// the signed-in person, never the model. Everything here came from an email or a Bandcamp page, so it is rendered as
// text: no auto-linking, no HTML (Hard Rule 5).

export type ReleaseStatus = "new" | "considering" | "played" | "passed";
export type RadarTab = "bandcamp" | "cosign";
type Embargo = { until: string | null };
export type Release = {
  _id: string;
  workspace: "real" | "demo";
  artist: string;
  title: string;
  label?: string;
  genre?: string;
  type?: "album" | "single" | "ep";
  releasedOn?: string;
  embargo?: Embargo;
  status: ReleaseStatus;
  passReason?: string;
  source?: RadarTab;
  senders?: { name?: string; address?: string; messageId: string; at: number }[];
  links?: string[];
  bandcampPage?: string;
  embed?: BandcampEmbed;
  embedState?: "queued" | "ready" | "failed";
  embedError?: string;
  embedQueuedAt?: number;
  laterEmbargoNotice?: { at: number; until: string | null };
  art?: string;
  tags?: string[];
  about?: string;
  favorite?: boolean;
  receivedAt?: number;
};
type EditFields = { label?: string; genre?: string; type?: "album" | "single" | "ep" | ""; releasedOn?: string };
export type RadarActions = {
  setStatus: (a: { releaseId: string; status: ReleaseStatus; reason?: string }) => Promise<unknown>;
  edit: (a: { releaseId: string; fields: EditFields }) => Promise<unknown>;
  setEmbargo: (a: { releaseId: string; embargo: Embargo | null }) => Promise<unknown>;
  retry: (a: { messageId: string }) => Promise<unknown>;
  retryEmbed: (a: { releaseId: string }) => Promise<unknown>;
  setFavorite: (a: { releaseId: string; favorite: boolean }) => Promise<unknown>;
};
export type ReleaseCtx = {
  actions: RadarActions;
  announce: (msg: string) => void;
  today: string;
  demo: boolean;
  tab: RadarTab;
  /** The tag the list is filtered on, if any; a tag chip's click sets or clears it. */
  tag?: string;
  onTag: (tag: string) => void;
  /** The release whose player is open (one at a time), and the call that opens one or (undefined) closes it. */
  playing?: string;
  onPlay: (releaseId: string | undefined) => void;
  /** The list mixes statuses (the All chip), so each block names its own. */
  showStatus?: boolean;
};

export const STATUS: Record<ReleaseStatus, [PillTone, string]> = {
  new: ["ready", "New"],
  considering: ["neutral", "Considering"],
  played: ["neutral", "Played"],
  passed: ["neutral", "Passed"],
};
const TYPE = { album: "Album", single: "Single", ep: "EP" } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Embargoed until Nov 7" (the year only when it isn't this year), "Embargoed · date not known", or null once lifted. */
export function embargoLabel(embargo: Embargo | undefined, today: string): string | null {
  if (!isEmbargoActive(embargo, today)) return null;
  if (embargo!.until === null) return "Embargoed · date not known";
  const [y, m, d] = embargo!.until.split("-");
  return `Embargoed until ${MONTHS[Number(m) - 1]} ${Number(d)}${y === today.slice(0, 4) ? "" : `, ${y}`}`;
}

const senderText = (r: Release) => [...new Set((r.senders ?? []).map((s) => s.name?.trim() || s.address).filter(Boolean))].join(", ");
const said = (r: Release) => `“${r.title}” by ${r.artist}`;

/** A stored link as plain text: the host in mono, then the full address. Opened only by Tarik's own click. */
function LinkLine({ href }: { href: string }) {
  let host: string;
  try {
    host = new URL(href).hostname;
  } catch {
    return null;
  }
  // Stored links are http(s) only (Task 2's validator); checked again here so no other scheme can ever be a link.
  if (!/^https?:\/\//i.test(href)) return null;
  return (
    <li className="flex min-w-0 flex-col gap-0.5 text-sm">
      <span className="font-mono text-[11px] text-muted">{host}</span>
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="w-fit max-w-full text-ink-soft underline underline-offset-2 [overflow-wrap:anywhere] hover:text-signal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal">
        {href}
      </a>
    </li>
  );
}

function Links({ links }: { links: string[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Links in the email" className="flex flex-col gap-2">{links.map((l) => <LinkLine key={l} href={l} />)}</ul>
      <p className="text-xs text-muted">Air Check didn&apos;t open these. Check them yourself.</p>
    </div>
  );
}

function PassForm({ r, ctx, onClose }: { r: Release; ctx: ReleaseCtx; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, save } = useSave(ctx.announce);
  const id = `pass-${r._id}`;
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const why = reason.trim();
    if (await save(() => ctx.actions.setStatus({ releaseId: r._id, status: "passed", ...(why && { reason: why }) }), `${said(r)} passed`)) onClose();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-ink-soft">Reason (optional)</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className={`${FIELD} min-w-0 flex-1 basis-56`} />
        <button type="submit" className={PRIMARY} disabled={busy}>Pass on it</button>
        <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
      </div>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </form>
  );
}

function EmbargoControl({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const [mode, setMode] = useState<"idle" | "date" | "clear">("idle");
  const [until, setUntil] = useState(r.embargo?.until ?? "");
  const { busy, error, save } = useSave(ctx.announce);
  const set = async (embargo: Embargo | null, done: string) => {
    if (await save(() => ctx.actions.setEmbargo({ releaseId: r._id, embargo }), done)) setMode("idle");
  };
  const now = embargoLabel(r.embargo, ctx.today) ?? "No embargo";
  const id = `embargo-${r._id}`;
  return (
    <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
      <legend className="float-left mb-1 w-full font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">Embargo</legend>
      <p className="clear-left text-sm text-ink-soft">{now}</p>
      {mode === "date" ? (
        <div className="flex flex-wrap items-end gap-2">
          <span className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm text-ink-soft">Embargoed until</label>
            <input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={FIELD} />
          </span>
          <button type="button" className={SECONDARY} disabled={busy || !until} onClick={() => set({ until }, `${said(r)} embargoed until ${showDateLabel(until)}`)}>Save date</button>
          <button type="button" className={SECONDARY} onClick={() => setMode("idle")}>Cancel</button>
        </div>
      ) : mode === "clear" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-control bg-caution-bg px-3 py-2 text-sm text-caution-text">
          <span className="min-w-0 flex-1 basis-40">This lets it reach Mixcloud.</span>
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => set(null, `Embargo cleared on ${said(r)}`)}>Clear it</button>
          <button type="button" className={SECONDARY} onClick={() => setMode("idle")}>Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} onClick={() => setMode("date")}>Set date</button>
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => set({ until: null }, `${said(r)} embargoed, date not known`)}>Date not known</button>
          {r.embargo && <button type="button" className={SECONDARY} onClick={() => setMode("clear")}>Clear embargo</button>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </fieldset>
  );
}

function EditForm({ r, ctx, onClose }: { r: Release; ctx: ReleaseCtx; onClose: () => void }) {
  const start: Required<EditFields> = { label: r.label ?? "", genre: r.genre ?? "", type: r.type ?? "", releasedOn: r.releasedOn ?? "" };
  const [f, setF] = useState(start);
  const { busy, error, save } = useSave(ctx.announce);
  const id = (k: string) => `edit-${r._id}-${k}`;
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const fields = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== start[k as keyof EditFields])) as EditFields;
    if (Object.keys(fields).length === 0) return onClose();
    if (await save(() => ctx.actions.edit({ releaseId: r._id, fields }), `${said(r)} saved`)) onClose();
  };
  const text = (k: "label" | "genre", label: string) => (
    <span className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
      <label htmlFor={id(k)} className="text-sm text-ink-soft">{label}</label>
      <input id={id(k)} value={f[k]} maxLength={200} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={FIELD} />
    </span>
  );
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          {text("label", "Label")}
          {text("genre", "Genre")}
          <span className="flex flex-col gap-1">
            <label htmlFor={id("type")} className="text-sm text-ink-soft">Type</label>
            <select id={id("type")} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as EditFields["type"] & string })} className={FIELD}>
              <option value="">Not known</option>
              <option value="album">Album</option>
              <option value="single">Single</option>
              <option value="ep">EP</option>
            </select>
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor={id("date")} className="text-sm text-ink-soft">Release date</label>
            <input id={id("date")} type="date" value={f.releasedOn} onChange={(e) => setF({ ...f, releasedOn: e.target.value })} className={FIELD} />
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY} disabled={busy}>Save</button>
          <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
        </div>
        {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
      </form>
    </div>
  );
}

// Phone: tighter side padding so Play, Consider, Pass and More share one row at 375px (height stays 44px).
const ACT = `${SECONDARY} max-md:px-3`;
const CHIP_TAGS = 3; // tags in the dates line; More shows every tag when there are more

/** Bandcamp's tags as chips. Each is a 44px target around a small pill (pulled into the line); a click filters the list. */
function Tags({ tags, ctx, label = "Tags" }: { tags: string[]; ctx: ReleaseCtx; label?: string }) {
  if (!tags.length) return null;
  return (
    <ul aria-label={label} className="-my-2.5 flex flex-wrap gap-x-1">
      {tags.map((t) => {
        const on = ctx.tag === t;
        return (
          <li key={t}>
            <button type="button" aria-pressed={on} onClick={() => ctx.onTag(t)} className="group inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-signal">
              <span className={`rounded-full px-2 py-0.5 text-xs [overflow-wrap:anywhere] ${on ? "bg-ink text-paper" : "bg-chip text-ink-soft group-hover:text-ink"}`}>{t}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The page's description: untrusted text, collapsed until asked for, never a link. */
function About({ text }: { text: string }) {
  return (
    <details className="group text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal [&::-webkit-details-marker]:hidden">
        <Chevron turn="group-open:rotate-90" />
        About
      </summary>
      <p className="max-w-[65ch] whitespace-pre-line pb-1 text-ink-soft [overflow-wrap:anywhere]">{text}</p>
    </details>
  );
}

/** A small drawn chevron; `turn` is its rotation class. */
function Chevron({ turn }: { turn: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={`shrink-0 transition-transform motion-reduce:transition-none ${turn}`}>
      <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Whether a block draws art: Bandcamp's own image host only, or the demo's placeholder on a Bandcamp row. */
const hasArt = (r: Release, ctx: ReleaseCtx) => (ctx.demo ? r.source !== "cosign" : !!r.art && bandcampArtUrl(r.art) === r.art);

/** Cover art: a lazy image with no referrer, only from Bandcamp's image host. The demo shows a placeholder (copyright). */
function Art({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const box = "size-14 md:size-16 shrink-0 rounded-control";
  if (!hasArt(r, ctx)) return null;
  if (ctx.demo)
    return (
      <span className={`${box} flex items-center justify-center border border-dashed border-line-strong text-center font-mono text-[10.5px] leading-tight text-muted`}>[Cover art]</span>
    );
  return <img src={r.art} alt={`Cover art for ${r.title} by ${r.artist}`} loading="lazy" referrerPolicy="no-referrer" width={64} height={64} className={`${box} border border-line bg-chip object-cover`} />;
}

function StarIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Tarik's star. Independent of status: it changes nothing else. */
function Favorite({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const { busy, error, save } = useSave(ctx.announce);
  const on = !!r.favorite;
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        aria-pressed={on}
        aria-label={`Favorite ${said(r)}`}
        disabled={busy}
        onClick={() => save(() => ctx.actions.setFavorite({ releaseId: r._id, favorite: !on }), on ? `${said(r)} taken off favorites` : `${said(r)} added to favorites`)}
        className={`-my-2.5 -mr-2.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control hover:bg-surface-quiet focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal disabled:opacity-60 ${on ? "text-ink" : "text-muted hover:text-ink"}`}
      >
        <StarIcon on={on} />
      </button>
      {error && <span role="alert" className="text-xs text-problem-text">{error}</span>}
    </span>
  );
}

/** Play, or Stop while this block's player is open. Drawn icons, one stroke weight (no glyphs). */
function PlayButton({ open, controls, onClick }: { open: boolean; controls: string; onClick: () => void }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onClick} className={`${ACT} gap-1.5`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        {open ? <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" /> : <path d="M3 1.8v8.4L10 6z" fill="currentColor" />}
      </svg>
      {open ? "Stop" : "Play"}
    </button>
  );
}

/** Whether a player could open now: a ready, well-formed id, or the demo's placeholder on a Bandcamp row. */
const canPlay = (r: Release, ctx: ReleaseCtx) => (ctx.demo ? r.source !== "cosign" : r.embedState === "ready" && !!r.embed);

function More({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const [editing, setEditing] = useState(false);
  const { busy, error, save } = useSave(ctx.announce);
  const page = r.bandcampPage;
  // Brief C: a Bandcamp email's own links are never shown (the page link is enough); a co-sign's cleaned links are.
  const links = ctx.tab === "cosign" ? (r.links ?? []).filter((l) => l !== page) : [];
  const allTags = (r.tags?.length ?? 0) > CHIP_TAGS ? r.tags! : [];
  const s = r.status;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      {editing ? (
        <EditForm r={r} ctx={ctx} onClose={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2 max-md:gap-1.5">
          {(s === "new" || s === "considering") && (
            <button type="button" className={ACT} disabled={busy} onClick={() => save(() => ctx.actions.setStatus({ releaseId: r._id, status: "played" }), `${said(r)} marked played`)}>Played</button>
          )}
          <button type="button" className={ACT} onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
      <EmbargoControl r={r} ctx={ctx} />
      {allTags.length > 0 && (
        <div className="flex flex-col gap-1 pt-1">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">All tags</p>
          <div className="py-2.5"><Tags tags={allTags} ctx={ctx} label="All tags" /></div>
        </div>
      )}
      {r.about && <About text={r.about} />}
      {page && <ul aria-label="Bandcamp page" className="flex flex-col"><LinkLine href={page} /></ul>}
      <Links links={links} />
    </div>
  );
}

const short = (label: string, today: string) => label.replace(`, ${today.slice(0, 4)}`, "");

export function ReleaseItem({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const [mode, setMode] = useState<"idle" | "pass">("idle");
  const [moreOpen, setMoreOpen] = useState(false);
  const { busy, error, save } = useSave(ctx.announce);
  const ids = useId();
  const playerId = `${ids}-player`;
  const moreId = `${ids}-more`;
  const [tone, word] = STATUS[r.status];
  const cosign = ctx.tab === "cosign";
  const sender = senderText(r);
  const embargo = embargoLabel(r.embargo, ctx.today);
  const open = ctx.playing === r._id;
  const playable = canPlay(r, ctx);
  // No player yet (or it failed): the player's own reason line, as before. The demo has none.
  const reason = !ctx.demo && (r.embedState === "queued" || r.embedState === "failed");
  const meta = [
    r.type && TYPE[r.type],
    r.genre,
    r.releasedOn && `Out ${short(showDateLabel(r.releasedOn), ctx.today)}`,
    r.receivedAt !== undefined && `received ${short(chicagoDateLabel(r.receivedAt), ctx.today)}`,
  ].filter(Boolean).join(" · ");
  const tags = (r.tags ?? []).slice(0, CHIP_TAGS);
  const move = (status: ReleaseStatus, done: string) => save(() => ctx.actions.setStatus({ releaseId: r._id, status }), `${said(r)} ${done}`);
  const s = r.status;
  const player = (autoPlay: boolean) => (
    <BandcampPlayer artist={r.artist} title={r.title} embed={r.embed} embedState={r.embedState} embedError={r.embedError} embedQueuedAt={r.embedQueuedAt} demo={ctx.demo} autoPlay={autoPlay} onRetry={() => ctx.actions.retryEmbed({ releaseId: r._id })} />
  );

  return (
    <li aria-label={`${r.artist} – ${r.title}`} className="flex min-w-0 flex-col gap-3 border-t border-line px-4 py-4 first:border-t-0 md:px-5">
      <div className="flex min-w-0 items-start gap-3 md:gap-4">
        <Art r={r} ctx={ctx} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-start gap-2">
            <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
              <span>{r.title}</span>
              {ctx.demo && <SampleTag />}
            </p>
            {ctx.showStatus && <Pill tone={tone}>{word}</Pill>}
            <Favorite r={r} ctx={ctx} />
          </div>
          <p className="text-[15px] text-ink-soft [overflow-wrap:anywhere]">{[r.artist, r.label].filter(Boolean).join(" · ")}</p>
          {cosign && sender && <p className="text-sm font-medium text-ink-soft [overflow-wrap:anywhere]">From {sender}</p>}
          {(meta || tags.length > 0 || embargo) && (
            <div data-meta className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-sm text-muted">
              {meta && <span className="tabular-nums [overflow-wrap:anywhere]">{meta}</span>}
              <Tags tags={tags} ctx={ctx} />
              {embargo && <Pill tone="caution">{embargo}</Pill>}
            </div>
          )}
          {r.laterEmbargoNotice && <p className="text-sm text-muted">A newer email mentions an embargo — you cleared it</p>}
          {s === "passed" && r.passReason && <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">Passed: {r.passReason}</p>}
          {reason && <div className="pt-1">{player(false)}</div>}
        </div>
      </div>

      {/* Desktop: the actions line up under the text column when there is art beside it. */}
      <div className={`flex flex-col gap-3 ${hasArt(r, ctx) ? "md:pl-20" : ""}`}>
        {mode === "pass" ? (
          <PassForm r={r} ctx={ctx} onClose={() => setMode("idle")} />
        ) : (
          <div role="group" aria-label="Actions" className="flex flex-nowrap items-center gap-2 max-md:gap-1.5">
            {playable && <PlayButton open={open} controls={playerId} onClick={() => ctx.onPlay(open ? undefined : r._id)} />}
            {s === "new" && <button type="button" className={ACT} disabled={busy} onClick={() => move("considering", "moved to Considering")}>Consider</button>}
            {(s === "new" || s === "considering") && <button type="button" className={ACT} onClick={() => setMode("pass")}>Pass</button>}
            {s !== "new" && <button type="button" className={`${ACT} whitespace-nowrap`} disabled={busy} onClick={() => move("new", "moved back to New")}>Back to New</button>}
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              onClick={() => setMoreOpen(!moreOpen)}
              className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal max-md:px-3"
            >
              More
              <Chevron turn={moreOpen ? "-rotate-90 transition-none" : "rotate-90 transition-none"} />
            </button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
        {open && playable && <div id={playerId}>{player(true)}</div>}
        {moreOpen && <div id={moreId}><More r={r} ctx={ctx} /></div>}
      </div>
    </li>
  );
}
