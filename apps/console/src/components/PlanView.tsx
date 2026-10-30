"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { showDateLabel } from "@/lib/date";
import { KIND_WORD, refusalText, type ResearchKind, type ResearchStatus, shortDate, STATUS_PILL } from "@/lib/research";
import { Pill } from "./Pill";

// Plan 7: the Plan page's two parts. A deep dive starts here (a sourced brief, never a script); every research job is
// listed, newest first, each opening its own page. The page wires these to Convex as the signed-in person.

type Subject = "artist" | "label" | "release";
export type ResearchRow = { jobId: string; kind: ResearchKind; showDate?: string; subject?: { name: string }; status: ResearchStatus; createdAt: number };

const FIELD = "min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal";
const LABEL = "text-sm font-medium";
const PRIMARY = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-control border border-signal bg-signal px-5 text-sm font-semibold text-white hover:bg-signal-deep disabled:opacity-60";

const rowTitle = (r: ResearchRow) => (r.kind === "deep-dive" ? `Deep dive: ${r.subject?.name ?? ""}` : `${KIND_WORD[r.kind]}, ${shortDate(r.showDate)}`);

export type StartDeepDive = (a: { type: Subject; name: string; showDate?: string }) => Promise<{ jobId: string }>;

export function DeepDiveForm({ start, onStarted, authReady = true }: { start: StartDeepDive; onStarted: (jobId: string) => void; authReady?: boolean }) {
  const [type, setType] = useState<Subject>("artist");
  const [name, setName] = useState("");
  const [showDate, setShowDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await start({ type, name: name.trim(), ...(showDate && { showDate }) });
      onStarted(jobId);
    } catch (err) {
      setError(refusalText(err));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="dd-h" className="rounded-card border border-line bg-surface p-5">
      <h2 id="dd-h" className="font-serif text-[22px] leading-tight">Deep dive</h2>
      <p className="mt-1 text-sm text-ink-soft">A sourced brief on an artist, label or release: 5 to 8 facts, each with its sources. Never a script.</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div className="flex flex-col gap-2">
            <label htmlFor="dd-type" className={LABEL}>Type</label>
            <select id="dd-type" value={type} onChange={(e) => setType(e.target.value as Subject)} className={FIELD}>
              <option value="artist">Artist</option>
              <option value="label">Label</option>
              <option value="release">Release</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="dd-name" className={LABEL}>Name</label>
            <input id="dd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" className={FIELD} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="dd-date" className={LABEL}>Show date (optional)</label>
          <input id="dd-date" type="date" value={showDate} onChange={(e) => setShowDate(e.target.value)} className={`${FIELD} sm:max-w-60`} />
          <p className="text-[12.5px] text-muted">With a date, the brief says how it connects to that show&apos;s tracklist. Closing tracks are never researched.</p>
        </div>
        {error && <p role="alert" className="rounded-control bg-problem-bg px-4 py-3 text-sm text-problem-text">{error}</p>}
        <button type="submit" className={`${PRIMARY} self-start`} disabled={!name.trim() || busy || !authReady}>
          {busy ? "Starting…" : "Start deep dive"}
        </button>
      </form>
    </section>
  );
}

export function ResearchList({ rows }: { rows: ResearchRow[] | undefined }) {
  return (
    <section aria-labelledby="list-h" className="rounded-card border border-line bg-surface">
      <h2 id="list-h" className="px-5 pb-2 pt-4 font-serif text-[22px] leading-tight">Research</h2>
      {rows === undefined ? (
        <p className="px-5 pb-4 text-sm text-ink-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted">Nothing researched yet.</p>
      ) : (
        <ul>
          {[...rows].sort((a, b) => b.createdAt - a.createdAt).map((r) => {
            const [tone, word] = STATUS_PILL[r.status];
            return (
              <li key={r.jobId} className="border-t border-line">
                <Link
                  href={`/research/${r.jobId}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-3 text-sm hover:bg-surface-quiet focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal"
                >
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{rowTitle(r)}</span>
                  <span className="flex items-center gap-3">
                    {r.kind === "deep-dive" && r.showDate && <span className="text-muted">for {showDateLabel(r.showDate)}</span>}
                    <Pill tone={tone}>{word}</Pill>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
