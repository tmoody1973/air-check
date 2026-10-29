"use client";

import { bandcampArtUrl, isEmbargoActive, type BandcampEmbed } from "@aircheck/core";
import { useState, type FormEvent, type ReactNode } from "react";
import { chicagoDateLabel, showDateLabel } from "../lib/date";
import { BandcampPlayer } from "./BandcampPlayer";
import { FIELD, PRIMARY, SECONDARY, useSave } from "./EpisodeControls";
import { Pill, type PillTone } from "./Pill";
import { SampleTag } from "./SampleTag";

// Plan 8 Task 6: one release record, drawn two ways like EpisodeItem: two table rows on a wide screen, a stacked card on
// a phone. The actions follow the theme-card pattern (accept / edit / dismiss): Consider, Played, Pass, Edit, with "Move
// back to New" as the undo. Each calls an injected Convex mutation as the signed-in person, never the model.
// Everything here came from an email or a Bandcamp page, so it is rendered as text: no auto-linking, no HTML (Hard Rule 5).
// Task 6b adds the page's cover art (a lazy image, no referrer), its tags (a click filters), the about (collapsed) and a
// favorite star that is independent of status. The sender line also carries the date the email was received.

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
      <EmbargoControl r={r} ctx={ctx} />
    </div>
  );
}

// Phone: tighter side padding and gap so Consider, Played, Pass and Edit share one row in a 375px card (height stays 44px).
const ACT = `${SECONDARY} max-md:px-3`;

function Actions({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const [open, setOpen] = useState<"pass" | "edit" | null>(null);
  const { busy, error, save } = useSave(ctx.announce);
  const move = (status: ReleaseStatus, done: string) => save(() => ctx.actions.setStatus({ releaseId: r._id, status }), `${said(r)} ${done}`);
  if (open === "pass") return <PassForm r={r} ctx={ctx} onClose={() => setOpen(null)} />;
  if (open === "edit") return <EditForm r={r} ctx={ctx} onClose={() => setOpen(null)} />;
  const s = r.status;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 max-md:gap-1.5">
        {s === "new" && <button type="button" className={ACT} disabled={busy} onClick={() => move("considering", "moved to Considering")}>Consider</button>}
        {(s === "new" || s === "considering") && (
          <>
            <button type="button" className={ACT} disabled={busy} onClick={() => move("played", "marked played")}>Played</button>
            <button type="button" className={ACT} onClick={() => setOpen("pass")}>Pass</button>
          </>
        )}
        {s !== "new" && <button type="button" className={ACT} disabled={busy} onClick={() => move("new", "moved back to New")}>Back to New</button>}
        <button type="button" className={ACT} onClick={() => setOpen("edit")}>Edit</button>
      </div>
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </div>
  );
}

/** Notes, the player, links and actions: the same in a table row's second line and on a phone card. */
function Body({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const page = r.bandcampPage;
  const others = (r.links ?? []).filter((l) => l !== page);
  const player = (
    <BandcampPlayer artist={r.artist} title={r.title} embed={r.embed} embedState={r.embedState} embedError={r.embedError} embedQueuedAt={r.embedQueuedAt} demo={ctx.demo} onRetry={() => ctx.actions.retryEmbed({ releaseId: r._id })} />
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Tags r={r} ctx={ctx} />
      {r.about && <About text={r.about} />}
      {r.laterEmbargoNotice && <p className="text-sm text-muted">A newer email mentions an embargo — you cleared it</p>}
      {r.status === "passed" && r.passReason && <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">Passed: {r.passReason}</p>}
      {/* A co-sign gets a player only through a Bandcamp link, so a demo co-sign has no player box. */}
      {((ctx.demo && r.source !== "cosign") || page || r.embedState) && (
        <div className="flex flex-col gap-2">
          {player}
          {page && <ul aria-label="Bandcamp page" className="flex flex-col"><LinkLine href={page} /></ul>}
        </div>
      )}
      <Links links={others} />
      <Actions r={r} ctx={ctx} />
    </div>
  );
}

/** Bandcamp's tags as chips. Each is a 44px target around a small pill; a click filters the list by it. */
function Tags({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  if (!r.tags?.length) return null;
  return (
    <ul aria-label="Tags" className="-my-1.5 flex flex-wrap gap-x-1.5">
      {r.tags.map((t) => {
        const on = ctx.tag === t;
        return (
          <li key={t}>
            <button type="button" aria-pressed={on} onClick={() => ctx.onTag(t)} className="group inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-signal">
              <span className={`rounded-full px-2.5 py-1 text-xs [overflow-wrap:anywhere] ${on ? "bg-ink text-paper" : "bg-chip text-ink-soft group-hover:text-ink"}`}>{t}</span>
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
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="transition-transform group-open:rotate-90 motion-reduce:transition-none">
          <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        About
      </summary>
      <p className="max-w-[65ch] whitespace-pre-line pb-1 text-ink-soft [overflow-wrap:anywhere]">{text}</p>
    </details>
  );
}

/** Cover art: a lazy image with no referrer, only from Bandcamp's image host. The demo shows a placeholder (copyright). */
function Art({ r, ctx, size }: { r: Release; ctx: ReleaseCtx; size: "sm" | "md" }) {
  const px = size === "md" ? 64 : 56;
  const box = size === "md" ? "size-16" : "size-14";
  if (ctx.demo)
    return r.source === "cosign" ? null : (
      <span className={`${box} flex shrink-0 items-center justify-center rounded-control border border-dashed border-line-strong text-center font-mono text-[10.5px] leading-tight text-muted`}>[Cover art]</span>
    );
  if (!r.art || bandcampArtUrl(r.art) !== r.art) return null;
  return <img src={r.art} alt={`Cover art for ${r.title} by ${r.artist}`} loading="lazy" referrerPolicy="no-referrer" width={px} height={px} className={`${box} shrink-0 rounded-control border border-line bg-chip object-cover`} />;
}

function StarIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 2.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
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
        className={`-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control hover:bg-surface-quiet focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal disabled:opacity-60 ${on ? "text-ink" : "text-muted hover:text-ink"}`}
      >
        <StarIcon on={on} />
      </button>
      {error && <span role="alert" className="text-xs text-problem-text">{error}</span>}
    </span>
  );
}

function Title({ r, ctx }: { r: Release; ctx: ReleaseCtx }) {
  const embargo = embargoLabel(r.embargo, ctx.today);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold [overflow-wrap:anywhere]">{r.artist}</span>
        {ctx.demo && <SampleTag />}
      </p>
      <p className="text-ink-soft [overflow-wrap:anywhere]">{r.title}</p>
      {embargo && <span className="w-fit"><Pill tone="caution">{embargo}</Pill></span>}
    </div>
  );
}

const meta = (parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");
/** "From X · received Oct 29, 2026", "From X", "Received Oct 29, 2026" or null: the sender line with the email's date. */
const fromLine = (sender: string, receivedAt?: number) => {
  const got = receivedAt === undefined ? undefined : chicagoDateLabel(receivedAt);
  if (sender) return got ? `From ${sender} · received ${got}` : `From ${sender}`;
  return got ? `Received ${got}` : null;
};
const released = (r: Release) => (r.releasedOn ? showDateLabel(r.releasedOn) : undefined);

export function ReleaseItem({ r, layout, ctx }: { r: Release; layout: "row" | "card"; ctx: ReleaseCtx }) {
  const [tone, word] = STATUS[r.status];
  const sender = senderText(r);
  const type = r.type && TYPE[r.type];
  const cosign = ctx.tab === "cosign";
  const from = fromLine(sender, r.receivedAt);

  if (layout === "card")
    return (
      <li aria-label={`${r.artist} – ${r.title}`} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4">
        {cosign && from && <p className="text-sm font-medium text-ink-soft [overflow-wrap:anywhere]">{from}</p>}
        <div className="flex items-start gap-3">
          <Art r={r} ctx={ctx} size="md" />
          <div className="min-w-0 flex-1"><Title r={r} ctx={ctx} /></div>
          <span className="flex shrink-0 items-start gap-1">
            <Pill tone={tone}>{word}</Pill>
            <Favorite r={r} ctx={ctx} />
          </span>
        </div>
        <p className="text-sm text-muted [overflow-wrap:anywhere]">{meta([r.label, r.genre, type, released(r) && `Out ${released(r)}`])}</p>
        {!cosign && from && <p className="text-sm text-muted [overflow-wrap:anywhere]">{from}</p>}
        <div className="border-t border-line pt-3"><Body r={r} ctx={ctx} /></div>
      </li>
    );

  const td = "px-3 py-3 align-top";
  const cells: ReactNode[] = cosign
    ? [<span key="from" className="font-medium text-ink-soft [overflow-wrap:anywhere]">{sender}</span>, meta([r.label, type])]
    : [r.label, meta([r.genre, type])];
  return (
    <>
      <tr aria-label={`${r.artist} – ${r.title}`} className="border-t border-line">
        <td className={td}>
          <div className="flex items-start gap-3">
            <Art r={r} ctx={ctx} size="sm" />
            <div className="min-w-0">
              <Title r={r} ctx={ctx} />
              {cosign
                ? r.receivedAt !== undefined && <p className="mt-1 text-sm text-muted">Received {chicagoDateLabel(r.receivedAt)}</p>
                : from && <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{from}</p>}
            </div>
          </div>
        </td>
        {cells.map((c, i) => <td key={i} className={`${td} [overflow-wrap:anywhere]`}>{c}</td>)}
        <td className={`${td} whitespace-nowrap`}>{released(r) ?? <span className="text-muted">[Not known]</span>}</td>
        <td className={td}>
          <span className="flex items-start gap-1">
            <Pill tone={tone}>{word}</Pill>
            <Favorite r={r} ctx={ctx} />
          </span>
        </td>
      </tr>
      <tr>
        <td colSpan={5} className="px-3 pb-4 pt-0">
          <div className="rounded-control bg-surface-quiet px-4 py-3">
            <Body r={r} ctx={ctx} />
          </div>
        </td>
      </tr>
    </>
  );
}
