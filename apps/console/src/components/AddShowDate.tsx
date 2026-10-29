import { useId, useState, type FormEvent } from "react";
import { showDateLabel } from "../lib/date";
import { FIELD, SECONDARY, useSave } from "./EpisodeControls";

// "Add a 2025 show": the backlog is 2026 by design; Tarik adds the few 2025 Fridays that never reached Mixcloud, one
// by one, so nothing already posted is drafted again. Before saving, the console's route checks Mixcloud's public list
// for a show on that date. Names from Mixcloud are untrusted: plain text only. Every button calls an injected action.

export type Posted = { date: string; name: string };
export type AddShowActions = {
  addShowDate: (a: { date: string }) => Promise<unknown>;
  removeShowDate: (a: { date: string }) => Promise<unknown>;
  /** GET /api/mixcloud/posted?year=2025; null when Mixcloud couldn't be read. */
  postedShows: () => Promise<Posted[] | null>;
};
type Props = { added: string[]; actions: AddShowActions; announce: (msg: string) => void };

const ERROR = "text-problem-text";
const NOTE = "rounded-control bg-caution-bg px-3 py-2 text-sm text-caution-text";

export function AddShowDate({ added, actions, announce }: Props) {
  const [date, setDate] = useState("");
  const [dupe, setDupe] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const { busy, error, save } = useSave(announce);
  const id = useId();
  const ok = /^2025-\d{2}-\d{2}$/.test(date);

  const add = async () => {
    setDupe(null);
    if (await save(() => actions.addShowDate({ date }), `Added ${showDateLabel(date)}. Checking Box, Drive and Paper in a minute or two.`)) setDate("");
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!ok) return;
    setChecking(true);
    setUnchecked(false);
    const posted = await actions.postedShows().catch(() => null);
    setChecking(false);
    if (!posted) {
      setUnchecked(true);
      return add();
    }
    const hit = posted.find((p) => p.date === date);
    if (hit) setDupe(hit.name);
    else await add();
  };

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 id={`${id}-h`} className="font-medium">Add a 2025 show</h2>
      <p className="mt-1 text-sm text-ink-soft">For a 2025 Friday that never reached Mixcloud. Air Check then reads its Box folder, Drive tracklist and Paper notes like a 2026 show.</p>
      <form onSubmit={(ev) => void submit(ev)} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-d`} className="text-sm text-ink-soft">2025 Friday</label>
        <input id={`${id}-d`} type="date" min="2025-01-01" max="2025-12-31" value={date}
          onChange={(e) => { setDate(e.target.value); setDupe(null); }} className={`${FIELD} min-w-0`} />
        <button type="submit" className={SECONDARY} disabled={!ok || busy || checking || dupe !== null}>{checking ? "Checking Mixcloud…" : "Save"}</button>
      </form>
      {dupe !== null && (
        <div className={`mt-3 flex flex-col gap-2 ${NOTE}`}>
          <p className="[overflow-wrap:anywhere]">Mixcloud already has a show for {showDateLabel(date)}: {dupe}. Add it anyway?</p>
          <p className="flex flex-wrap gap-2">
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => void add()}>Add anyway</button>
            <button type="button" className={SECONDARY} onClick={() => setDupe(null)}>Cancel</button>
          </p>
        </div>
      )}
      {unchecked && <p className="mt-2 text-sm text-ink-soft">Couldn&apos;t check Mixcloud.</p>}
      {error && <p role="alert" className={`mt-2 text-sm ${ERROR}`}>{error}</p>}
      {added.length > 0 && (
        <>
          <h3 id={`${id}-l`} className="mt-4 text-sm font-medium">Added</h3>
          <ul aria-labelledby={`${id}-l`} className="mt-1 flex flex-col divide-y divide-line">
            {added.map((d) => <AddedItem key={d} date={d} actions={actions} announce={announce} />)}
          </ul>
        </>
      )}
    </section>
  );
}

/** One added date. Remove asks first; Convex refuses once the show has a package or an open draft run. */
function AddedItem({ date, actions, announce }: { date: string; actions: AddShowActions; announce: (msg: string) => void }) {
  const [asking, setAsking] = useState(false);
  const { busy, error, save } = useSave(announce);
  const label = showDateLabel(date);
  const remove = async () => {
    if (await save(() => actions.removeShowDate({ date }), `Removed ${label}. Its row leaves Episodes after the next check.`)) setAsking(false);
  };
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium tabular-nums">{label}</span>
        {!asking && <button type="button" className={SECONDARY} onClick={() => setAsking(true)}>Remove</button>}
      </div>
      {asking && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Remove {label} from the backlog?</span>
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => void remove()}>Yes, remove</button>
          <button type="button" className={SECONDARY} onClick={() => setAsking(false)}>Keep</button>
        </div>
      )}
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </li>
  );
}
