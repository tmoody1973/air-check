import { useId, useState, type FormEvent } from "react";
import { showDateLabel } from "../lib/date";
import { correctedText, SOURCE_NAME } from "../lib/episodes";
import { FIELD, SECONDARY, useSave, type CorrectedField, type EpisodeActions, type EpisodeRow, type Fix, type FixSource, type Question, type RowCtx } from "./EpisodeControls";
import { CHECKING } from "./TracklistFix";

// Plan 6b (decision 017): the in-console fix offered under a question, the "Corrected in Air Check" line with its undo,
// and the undated names list. Every button calls an injected Convex mutation as the signed-in person, never the model.

const NAME = "font-mono text-[12.5px] [overflow-wrap:anywhere]";
const ERROR = "text-problem-text";

/** True when the row offers an in-console audio fix, so the R5 copy-by-hand note is not shown (no one copies by hand). */
export const hasAudioFix = (qs: readonly Question[]) =>
  qs.some((q) => q.fix && (q.fix.type === "hours" || q.fix.type === "stamp" || (q.fix.type === "pick" && q.fix.source === "box")));

/**
 * The scanner's special-folder question ends with the copy-by-hand step; with the hours picker under it, that step is
 * dropped. ponytail: matched on the scanner's wording; if it changes, the sentence just shows again (harmless).
 */
export const withoutHandCopy = (text: string) => text.replace(/\s*If \S+ should be posted, copy its two hour WAVs into the inbox by hand\.$/, "");

/** "Fix the tracklist": once per row (M2), however many questions offer it; it opens the row's one editor. */
export const TracklistFixButton = ({ onEdit }: { onEdit: () => void }) => (
  <div>
    <button type="button" className={SECONDARY} onClick={onEdit}>Fix the tracklist</button>
  </div>
);

/**
 * The control that settles one question in Air Check. Nothing on a frozen show (package or open run, M1): it is
 * changed on the package page. The tracklist fix is the row's TracklistFixButton, not one per question.
 */
export function FixControl({ showDate, fix, ctx, canChange }: { showDate: string; fix: Fix; ctx: RowCtx; canChange: boolean }) {
  if (!canChange || fix.type === "tracklist") return null;
  if (fix.type === "pick") return <PickFix showDate={showDate} fix={fix} ctx={ctx} />;
  if (fix.type === "hours") return <HoursFix showDate={showDate} fix={fix} ctx={ctx} />;
  return <StampFix showDate={showDate} folderDate={fix.folderDate} ctx={ctx} />;
}

function PickFix({ showDate, fix, ctx }: { showDate: string; fix: Extract<Fix, { type: "pick" }>; ctx: RowCtx }) {
  const { busy, error, save } = useSave(ctx.announce);
  const base = useId();
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {fix.choices.map((c, i) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span id={`${base}-${i}`} className={`${NAME} min-w-0`}>{c.name}</span>
            <button type="button" aria-describedby={`${base}-${i}`} className={SECONDARY} disabled={busy}
              onClick={() => save(() => ctx.actions.pick({ showDate, source: fix.source, id: c.id }), CHECKING)}>
              Use this one
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </div>
  );
}

function HoursFix({ showDate, fix, ctx }: { showDate: string; fix: Extract<Fix, { type: "hours" }>; ctx: RowCtx }) {
  const [hour1, setHour1] = useState("");
  const [hour2, setHour2] = useState("");
  const { busy, error, save } = useSave(ctx.announce);
  const base = useId();
  const ready = hour1 !== "" && hour2 !== "" && hour1 !== hour2;
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (ready) void save(() => ctx.actions.setHours({ showDate, hour1, hour2 }), CHECKING);
  };
  const select = (hour: 1 | 2, value: string, set: (v: string) => void) => (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor={`${base}-${hour}`} className="w-14 text-ink-soft">Hour {hour}</label>
      <select id={`${base}-${hour}`} value={value} onChange={(e) => set(e.target.value)} className={`${FIELD} min-w-0 max-w-full font-mono`}>
        <option value="">Choose a file</option>
        {fix.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </span>
  );
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {select(1, hour1, setHour1)}
        {select(2, hour2, setHour2)}
        <button type="submit" className={SECONDARY} disabled={busy || !ready}>Save hours</button>
      </div>
      {hour1 !== "" && hour1 === hour2 && <p className="text-muted">Hour 1 and Hour 2 need different files.</p>}
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </form>
  );
}

function StampFix({ showDate, folderDate, ctx }: { showDate: string; folderDate: string; ctx: RowCtx }) {
  const { busy, error, save } = useSave(ctx.announce);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => save(() => ctx.actions.useFolderDate({ showDate }), CHECKING)}>
          This show is {showDateLabel(folderDate)}
        </button>
      </div>
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </div>
  );
}

/** Which source a fixed field stands in for, so a stale fix names the one it no longer matches (A3). */
const FIELD_SOURCE: Record<CorrectedField, string> = { tracklist: "Drive", drive: "Drive", paper: "Paper", box: "Box", hours: "Box", folderDate: "Box" };
const sourcesOf = (fields: readonly CorrectedField[]) => new Intl.ListFormat("en", { type: "conjunction" }).format([...new Set(fields.map((f) => FIELD_SOURCE[f]))]);

/**
 * The row's fix state: waiting for its scan, stale (won't draft), or corrected with "Remove my fix". `canChange`:
 * no package and no open run (a frozen show is changed on the package page, so it gets no instruction to act here).
 */
export function CorrectedLine({ e, ctx, canChange }: { e: EpisodeRow; ctx: RowCtx; canChange: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, save } = useSave(ctx.announce);
  const c = e.corrected;
  if (!c && !e.rescanPending) return null;
  // While the scan that applies a fix is pending, a stale flag is from the scan before it. A4: only where it can be acted on.
  const stale = !!c?.stale && !e.rescanPending && canChange;
  const undo = async () => {
    if (await save(() => ctx.actions.clearCorrection({ showDate: e.showDate }), "Your fix was removed. Checking again in a minute or two.")) setConfirming(false);
  };
  return (
    <div className="flex flex-col gap-2">
      {e.rescanPending && <p className="text-ink-soft">Checking your fix…</p>}
      {stale ? (
        <p className={ERROR}>
          <span className="font-medium">Your fix no longer matches {sourcesOf(c!.fields)}. Remove your fix or fix it again.</span> This show won&apos;t be drafted until then.
        </p>
      ) : (
        c && <p>Corrected in Air Check ({correctedText(c.fields)})</p>
      )}
      {c && canChange &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">Your fix will be removed.</p>
            <button type="button" className={SECONDARY} disabled={busy} onClick={undo}>Remove my fix</button>
            <button type="button" className={SECONDARY} onClick={() => setConfirming(false)}>Keep my fix</button>
          </div>
        ) : (
          <div>
            <button type="button" className={SECONDARY} onClick={() => setConfirming(true)}>Remove my fix</button>
          </div>
        ))}
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </div>
  );
}

export type Unplaced = { source: FixSource; id: string; name: string; reason: string; seenAt: number };
/** A name Tarik put on a show (I1): still listed after the scan drops it from the undated names, to move or undo. */
export type Placed = { source: FixSource; id: string; name: string; date: string };
type Names = { items: Unplaced[]; placements: Placed[]; actions: EpisodeActions; announce: (msg: string) => void };

const SOURCE_LABEL = "font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted";

/** "Couldn't tell the date of these": names the scanner found but couldn't date. Placing one never renames it. */
export function UndatedList({ items, placements, actions, announce }: Names) {
  return (
    <section aria-labelledby="undated-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 id="undated-heading" className="font-medium">Couldn&apos;t tell the date of these</h2>
      <p className="mt-1 text-sm text-ink-soft">Air Check found them but couldn&apos;t read a show date in the name. Choose the show each one belongs to; nothing is renamed.</p>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {items.map((u) => <UndatedItem key={`${u.source}:${u.id}`} u={u} actions={actions} announce={announce} />)}
        </ul>
      )}
      {placements.length > 0 && (
        <>
          <h3 id="placed-heading" className="mt-4 text-sm font-medium">Placed by you</h3>
          <ul aria-labelledby="placed-heading" className="mt-1 flex flex-col divide-y divide-line">
            {placements.map((p) => <PlacedItem key={`${p.source}:${p.id}`} p={p} actions={actions} announce={announce} />)}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * A date input plus Save that calls place; `label` names it. Rhythm Lab airs Fridays: Convex refuses any other day, and
 * a 2025 date that wasn't added under "Add a 2025 show", in plain words.
 */
function PlaceForm({ label, onSave, busy }: { label: string; onSave: (date: string) => void; busy: boolean }) {
  const [date, setDate] = useState("");
  const id = useId();
  const ok = /^202[56]-\d{2}-\d{2}$/.test(date);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (ok) onSave(date);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-ink-soft">{label}</label>
      <input id={id} type="date" min="2025-01-01" max="2026-12-31" value={date} onChange={(e) => setDate(e.target.value)} className={`${FIELD} min-w-0`} />
      <button type="submit" className={SECONDARY} disabled={busy || !ok}>Save</button>
    </form>
  );
}

function UndatedItem({ u, actions, announce }: { u: Unplaced; actions: EpisodeActions; announce: (msg: string) => void }) {
  const { busy, error, save } = useSave(announce);
  // Once saved it moves to "Placed by you" (the query updates before the mutation returns).
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <p className="flex flex-col gap-0.5">
        <span className={SOURCE_LABEL}>{SOURCE_NAME[u.source]}</span>
        <span className={NAME}>{u.name}</span>
        {u.reason && <span className="text-ink-soft [overflow-wrap:anywhere]">{u.reason}</span>}
      </p>
      <PlaceForm label="This is the show for…" busy={busy} onSave={(date) => void save(() => actions.place({ source: u.source, id: u.id, date }), CHECKING)} />
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </li>
  );
}

function PlacedItem({ p, actions, announce }: { p: Placed; actions: EpisodeActions; announce: (msg: string) => void }) {
  const [moving, setMoving] = useState(false);
  const { busy, error, save } = useSave(announce);
  const move = async (date: string) => {
    if (await save(() => actions.place({ source: p.source, id: p.id, date }), CHECKING)) setMoving(false);
  };
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-col gap-0.5">
          <span className={SOURCE_LABEL}>{SOURCE_NAME[p.source]}</span>
          <span className="[overflow-wrap:anywhere]"><span className={NAME}>{p.name}</span> → {showDateLabel(p.date)}</span>
        </p>
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => void save(() => actions.unplace({ source: p.source, id: p.id }), `${p.name} is undated again`)}>Undo</button>
        {!moving && <button type="button" className={SECONDARY} onClick={() => setMoving(true)}>Move</button>}
      </div>
      {moving && <PlaceForm label="Move to" busy={busy} onSave={(date) => void move(date)} />}
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </li>
  );
}
