"use client";

import { Fragment, useState, type ReactNode } from "react";
import { disagreement, type JudgedClaim, linkedSources, noteBullets, noteName, reviewNotes } from "@aircheck/core";
import {
  codeOf, embargoOf, embargoWords, type Embargo, isActive, isOpenClaim, isSample, refusalText, type ResearchEntryRow, type ResearchView,
} from "@/lib/research";
import { ClaimLine, SourceChips, VERIFY_CHIP } from "./ClaimLine";
import { Pill } from "./Pill";

// Plan 7 show notes, shaped like Tarik's Oct 23 Paper notes (Oct 29): per hour an intro and the hour thread, then one
// block per track of labeled bullets in his order, and Notes for Your Review at the end. Every sentence the model wrote is
// plain text; labels, names, statuses, links and dates are code's (core's noteBullets and reviewNotes, shared with the
// Markdown export). Every button calls a Convex mutation as the signed-in person (injected as `actions`), never the model.

export type BlockActions = {
  edit: (key: string, text: string) => Promise<unknown>;
  setPrivate: (key: string, isPrivate: boolean) => Promise<unknown>;
  setNote: (key: string, note: string) => Promise<unknown>;
  regenerate: (key: string, overwriteEdit: boolean) => Promise<unknown>;
};

const TEXT_BTN = "min-h-11 text-sm text-ink-soft underline underline-offset-2 hover:text-ink disabled:text-muted focus-visible:outline-2 focus-visible:outline-signal";
const SECONDARY = "inline-flex min-h-11 items-center whitespace-nowrap rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-quiet disabled:text-muted";
const PRIMARY = "inline-flex min-h-11 items-center whitespace-nowrap rounded-control border border-signal bg-signal px-4 text-sm font-semibold text-white hover:bg-signal-deep disabled:opacity-60";
const FIELD = "w-full rounded-control border border-line-strong bg-surface p-3 text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal";
export const LABEL = "font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted";

/** The pills a block carries: Private (his mark, the agent's, or an active embargo), the embargo date, and his edit. */
export function BlockPills({ entry, embargo, today }: { entry?: ResearchEntryRow; embargo?: Embargo; today: string }) {
  const held = embargoWords(embargo, today);
  if (!held && !entry?.private && !entry?.edited) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {(held || entry?.private) && <Pill tone="problem">Private</Pill>}
      {held && <Pill tone="caution">{held}</Pill>}
      {entry?.edited && <Pill tone="neutral">Edited by you</Pill>}
    </span>
  );
}

const plainOf = (e?: ResearchEntryRow) =>
  e?.edited?.text ?? [e?.intro, ...(e?.claims ?? []).map((c) => c.text), e?.replacement, e?.note].filter(Boolean).join("\n");

/** Edit, Mark private, Add your note and Regenerate for one block. */
export function BlockControls({ blockKey, name, entry, view, actions, note = false }: {
  blockKey: string; name: string; entry?: ResearchEntryRow; view: ResearchView; actions: BlockActions; note?: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "edit" | "note" | "confirm">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = isActive(view.job.status);
  const isPrivate = !!entry?.private;
  // ponytail: the seeded sample is shared by every demo visitor, so it is read-only; their own jobs keep every control.
  if (isSample(view)) return null;

  async function run(call: () => Promise<unknown>, after: typeof mode = "idle") {
    setBusy(true);
    setError(null);
    try {
      await call();
      setMode(after);
    } catch (e) {
      if (codeOf(e) === "HAS_EDITS") setMode("confirm");
      else setError(refusalText(e));
    } finally {
      setBusy(false);
    }
  }
  const open = (m: "edit" | "note") => {
    setText(m === "edit" ? plainOf(entry) : (entry?.suppliedNote ?? ""));
    setError(null);
    setMode(m);
  };
  const regenerate = () => (entry?.edited ? setMode("confirm") : run(() => actions.regenerate(blockKey, false)));

  return (
    <div className="flex flex-col gap-2">
      {mode === "edit" || mode === "note" ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label={mode === "edit" ? `Edit ${name}` : `Your note for ${name}`}
            value={text} onChange={(e) => setText(e.target.value)} maxLength={mode === "edit" ? 4000 : 2000}
            className={`${FIELD} ${mode === "edit" ? "min-h-40" : "min-h-24"}`}
          />
          {mode === "note" && <p className="text-[12.5px] text-muted">Shown as your supplied note, apart from the sourced facts.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => run(() => (mode === "edit" ? actions.edit(blockKey, text) : actions.setNote(blockKey, text)))}>
              {mode === "edit" ? "Save" : "Save note"}
            </button>
            <button type="button" className={SECONDARY} onClick={() => setMode("idle")}>Cancel</button>
          </div>
        </div>
      ) : mode === "confirm" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-control bg-caution-bg px-3 py-2 text-sm text-caution-text">
          <span className="min-w-0 flex-1 basis-56">This block has your edits. Regenerate anyway?</span>
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => run(() => actions.regenerate(blockKey, true))}>Regenerate anyway</button>
          <button type="button" className={SECONDARY} onClick={() => setMode("idle")}>Keep mine</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4">
          <button type="button" className={TEXT_BTN} onClick={() => open("edit")}>Edit</button>
          <button type="button" className={TEXT_BTN} disabled={busy} onClick={() => run(() => actions.setPrivate(blockKey, !isPrivate))}>
            {isPrivate ? "Unmark private" : "Mark private"}
          </button>
          {note && <button type="button" className={TEXT_BTN} onClick={() => open("note")}>{entry?.suppliedNote ? "Edit your note" : "Add your note"}</button>}
          {!active && <button type="button" className={TEXT_BTN} disabled={busy} onClick={regenerate}>Regenerate</button>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
    </div>
  );
}

/** One sentence as his notes show it: the text, a conflict's two versions, short host links, then [verify]. */
function Sentence({ claim }: { claim: JudgedClaim }) {
  const conflict = disagreement(claim);
  return (
    <span>
      <span>{claim.text}</span>
      {conflict && <>{" "}<span className="text-caution-text">{conflict}</span></>}
      <SourceChips sources={linkedSources(claim)} short />
      {isOpenClaim(claim) && <>{" "}<span className={VERIFY_CHIP}>[verify]</span></>}
    </span>
  );
}

function Prose({ claims }: { claims: JudgedClaim[] }) {
  return <>{claims.map((c, i) => <Fragment key={i}>{i > 0 && " "}<Sentence claim={c} /></Fragment>)}</>;
}

/** A track's labeled bullets (or the could / couldn't verify pair), then his own note, the angle and the agent's note. */
function TrackNotes({ entry, angles }: { entry: ResearchEntryRow; angles: boolean }) {
  return (
    <ul className="flex flex-col gap-2.5 text-sm [overflow-wrap:anywhere]">
      {noteBullets(entry.claims).map((b) => (
        <li key={b.label}>
          <span className="font-semibold">{b.label}:</span>{" "}
          {b.lead && <><span>{b.lead}</span>{" "}</>}
          <Prose claims={b.claims} />
        </li>
      ))}
      {entry.note && <li className="text-ink-soft"><span className="font-semibold">Note:</span> <span>{entry.note}</span></li>}
      {angles && entry.angle && <li><span className="font-semibold">On-air angle:</span> <span>{entry.angle}</span></li>}
    </ul>
  );
}

/** The block's body: his edit in place of everything generated, else the intro, the hour thread or the track's notes. */
function Body({ entry, angles }: { entry?: ResearchEntryRow; angles: boolean }) {
  if (!entry || (!entry.claims.length && !entry.edited && !entry.intro && !entry.angle && !entry.note && !entry.suppliedNote))
    return <p className="text-sm text-muted">Not researched yet.</p>;
  if (entry.edited) return <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{entry.edited.text}</p>;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {entry.intro && <p className="[overflow-wrap:anywhere]">{entry.intro}</p>}
      {entry.block === "threads" ? (
        entry.claims.length > 0 && <p className="[overflow-wrap:anywhere]"><Prose claims={entry.claims} /></p>
      ) : (
        (entry.claims.length > 0 || entry.note || (angles && entry.angle)) && <TrackNotes entry={entry} angles={angles} />
      )}
      {entry.suppliedNote && (
        <p className="rounded-control bg-surface-quiet px-3 py-2 [overflow-wrap:anywhere]">
          <span className="font-medium">Supplied note</span>{" "}
          <span className="text-muted">(from your supplied notes, which I did not independently check)</span>{" "}
          <span>{entry.suppliedNote}</span>
        </p>
      )}
    </div>
  );
}

/** Every flag, one line per track or hour thread, with code's reason: what to check before air. */
function ReviewNotes({ view }: { view: ResearchView }) {
  const notes = reviewNotes(view.tracks, view.entries);
  return (
    <section aria-labelledby="review-notes" className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4">
      <h2 id="review-notes" className="font-serif text-[22px] leading-tight">Notes for Your Review</h2>
      {notes.length ? (
        <ul className="flex flex-col gap-2 text-sm [overflow-wrap:anywhere]">
          {notes.map((n) => <li key={n.key}><span className="font-semibold">{n.name}:</span> <span>{n.items.join("; ")}.</span></li>)}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing to verify.</p>
      )}
    </section>
  );
}

export function Claims({ claims }: { claims: JudgedClaim[] }) {
  if (!claims.length) return null;
  return (
    <ul className="flex flex-col gap-2.5">
      {claims.map((c, i) => <li key={i}><ClaimLine claim={c} /></li>)}
    </ul>
  );
}

function Block({ label, name, head, children }: { label: string; name: ReactNode; head?: ReactNode; children: ReactNode }) {
  return (
    <article className="flex flex-col gap-3 border-t border-line px-5 py-4">
      <header className="grid grid-cols-[44px_1fr] items-baseline gap-2.5">
        <span className="font-mono text-xs text-muted">{label}</span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="font-medium [overflow-wrap:anywhere]">{name}</h3>
          {head}
        </div>
      </header>
      <div className="flex flex-col gap-3 sm:pl-[54px]">{children}</div>
    </article>
  );
}

export function ShowNotesCard({ view, today, actions }: { view: ResearchView; today: string; actions: BlockActions }) {
  const byKey = new Map(view.entries.map((e) => [e.key, e]));
  const hours = ([1, 2] as const).filter((h) => view.tracks.some((t) => t.hour === h));
  return (
    <div className="flex flex-col gap-5">
      {hours.map((h) => {
        const intro = byKey.get(`H${h}.intro`);
        const threads = byKey.get(`H${h}.threads`);
        return (
          <section key={h} aria-labelledby={`hour-${h}`} className="overflow-hidden rounded-card border border-line bg-surface">
            <h2 id={`hour-${h}`} className="px-5 pb-3 pt-4 font-serif text-[22px] leading-tight">Hour {h}</h2>
            <Block label="Intro" name={`Hour ${h} intro`} head={<BlockPills entry={intro} today={today} />}>
              <Body entry={intro} angles={false} />
              <BlockControls blockKey={`H${h}.intro`} name={`Hour ${h} intro`} entry={intro} view={view} actions={actions} />
            </Block>
            <Block label="Thread" name="Hour thread" head={<BlockPills entry={threads} today={today} />}>
              <Body entry={threads} angles={false} />
              <BlockControls blockKey={`H${h}.threads`} name={`Hour ${h} thread`} entry={threads} view={view} actions={actions} />
            </Block>
            {view.tracks.filter((t) => t.hour === h).map((t) => {
              const e = byKey.get(t.key);
              return t.closing ? (
                <Block key={t.key} label={t.key} name={noteName(t)}>
                  <p className="text-sm text-muted">closing track, no notes</p>
                </Block>
              ) : (
                <Block key={t.key} label={t.key} name={noteName(t)} head={<BlockPills entry={e} embargo={embargoOf(t)} today={today} />}>
                  <Body entry={e} angles={view.job.angles} />
                  <BlockControls blockKey={t.key} name={t.key} entry={e} view={view} actions={actions} note />
                </Block>
              );
            })}
          </section>
        );
      })}
      <ReviewNotes view={view} />
    </div>
  );
}

/** Copy for Paper and Download: the private Markdown export. Nothing is ever written to Paper (Hard Rule 12). */
export function ExportBar({ markdown, fileName }: { markdown: string | null | undefined; fileName: string }) {
  const [said, setSaid] = useState({ text: "", n: 0 });
  const say = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));
  const ready = typeof markdown === "string" && markdown.length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown!);
      say("Copied. Paste it into Paper.");
    } catch {
      say("Couldn't copy here. Use Download instead.");
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([markdown!], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!ready} onClick={copy}>Copy for Paper</button>
        <button type="button" className={SECONDARY} disabled={!ready} onClick={download}>Download</button>
        <p role="status" className="text-sm text-ink-soft">{said.text}{said.n % 2 ? " " : ""}</p>
      </div>
      <p className="text-[12.5px] text-muted">Private. Never pasted into a Mixcloud description. Embargoed blocks are marked PRIVATE in the export.</p>
    </div>
  );
}
