"use client";

import { parseTracklist, type Track } from "@aircheck/core";
import { useMemo, useRef, useState } from "react";

export type DraftForm = { showDate: string; tracklistText: string; notes: string };
export type DraftFn = (form: DraftForm) => Promise<{ runId: string }>;

// Mirror the server limits in convex/tracklist.ts; the server stays the authority.
const MAX_TRACKLIST = 50_000;
const MAX_NOTES = 20_000;
const NEAR = 0.9;

const GENERIC = "Couldn't start the draft. Please try again.";
const MESSAGES: Record<string, string> = {
  RATE_LIMITED: "Demo limit reached. Try again in a few minutes.",
  INVALID_INPUT: "Check the date and the tracklist.",
};
const REASONS = {
  "no-separator": "Needs “Artist - Title”",
  "before-hour-marker": "Add a HOUR 1 or HOUR 2 line above this",
} as const;

/** ConvexError carries `{ code }` in `.data`; anything else (or an unknown code) gets the generic line. */
function plainError(e: unknown): string {
  const code = (e as { data?: { code?: unknown } } | null)?.data?.code;
  return typeof code === "string" && Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : GENERIC;
}

const FIELD = "w-full rounded-control border border-line-strong bg-surface p-3.5 text-ink";
const LABEL = "text-sm font-medium";

function Count({ n, max }: { n: number; max: number }) {
  if (n < max * NEAR) return null;
  return (
    <p className={`font-mono text-xs ${n > max ? "text-problem-text" : "text-muted"}`}>
      {n.toLocaleString("en-US")} / {max.toLocaleString("en-US")} characters
    </p>
  );
}

function TrackRow({ t }: { t: Track }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-sm">
      <span className="w-10 flex-none font-mono text-xs text-muted">{t.hour}.{t.position}</span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {t.artist} - {t.title}
        {t.feat ? ` (feat. ${t.feat})` : ""}
      </span>
      {t.closing && <span className="rounded-full bg-chip px-2.5 py-px text-xs text-ink-soft">closing track</span>}
    </li>
  );
}

export function TracklistEditor({
  draft,
  onDone,
  initial,
  loadFailed = false,
}: {
  draft: DraftFn;
  onDone: (runId: string) => void;
  initial?: DraftForm;
  loadFailed?: boolean;
}) {
  const [showDate, setShowDate] = useState(initial?.showDate ?? "");
  const [text, setText] = useState(initial?.tracklistText ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false); // state updates lag a fast double click; a ref does not

  const { tracks, bad } = useMemo(() => parseTracklist(text), [text]);
  const count = (h: 1 | 2) => tracks.filter((t) => t.hour === h).length;
  const [h1, h2] = [count(1), count(2)];
  const closing = tracks.filter((t) => t.closing).length;
  const overLimit = text.length > MAX_TRACKLIST || notes.length > MAX_NOTES;
  const ready = showDate !== "" && h1 > 0 && h2 > 0 && bad.length === 0 && !overLimit;

  const hint = [
    showDate === "" && "Pick the show date.",
    (h1 === 0 || h2 === 0) && "Both hours need at least one track.",
    bad.length > 0 && "Fix the flagged lines.",
    overLimit && "Over the length limit.",
  ].filter(Boolean).join(" ");

  async function submit() {
    if (!ready || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { runId } = await draft({ showDate, tracklistText: text, notes });
      onDone(runId);
    } catch (e) {
      console.error("tracklist.draft failed", e);
      setError(plainError(e));
      sending.current = false;
      setBusy(false);
    }
  }

  const rows = (hour: 1 | 2) => {
    const own = tracks.filter((t) => t.hour === hour);
    const flagged = bad.filter((b) => b.hour === hour);
    return { own, flagged };
  };

  return (
    <div className="flex max-w-[980px] flex-col gap-5">
      <p className="text-[15px] leading-relaxed text-ink-soft">
        Paste the playlist for a new show, one track per line, with a HOUR 1 and HOUR 2 line. The last song of each hour is marked as a closing track automatically.
      </p>
      {loadFailed && <p className="text-sm text-muted">That draft couldn&apos;t be loaded.</p>}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="tl-date" className={LABEL}>Show date</label>
            <input id="tl-date" type="date" value={showDate} onChange={(e) => setShowDate(e.target.value)} className={`${FIELD} min-h-11 max-w-full py-2 sm:max-w-60`} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="tl-text" className={LABEL}>Tracklist</label>
            <textarea
              id="tl-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className={`${FIELD} min-h-80 resize-y font-mono text-[13px] leading-relaxed`}
            />
            <Count n={text.length} max={MAX_TRACKLIST} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="tl-notes" className={LABEL}>Private notes · never published</label>
            <textarea id="tl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${FIELD} min-h-28 resize-y text-sm leading-relaxed`} />
            <Count n={notes.length} max={MAX_NOTES} />
          </div>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <p className="text-sm font-medium" aria-live="polite">
            Hour 1: {h1} {h1 === 1 ? "track" : "tracks"} · Hour 2: {h2} {h2 === 1 ? "track" : "tracks"} · {closing} closing
            {bad.length > 0 && ` · ${bad.length} ${bad.length === 1 ? "line" : "lines"} to fix`}
          </p>
          {([1, 2] as const).map((hour) => {
            const { own, flagged } = rows(hour);
            return (
              <section key={hour} aria-label={`Hour ${hour}`} className="rounded-card border border-line bg-surface py-2">
                <h3 className="px-4 py-1 font-mono text-[11px] tracking-widest text-muted uppercase">Hour {hour}</h3>
                {own.length === 0 && flagged.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-muted">Hour {hour} has no tracks yet.</p>
                ) : (
                  <ul>
                    {own.map((t) => <TrackRow key={`${t.hour}.${t.position}`} t={t} />)}
                    {flagged.map((b) => (
                      <li key={b.line} className="flex flex-wrap items-baseline gap-x-2 bg-problem-row px-4 py-2 text-sm">
                        <span className="w-10 flex-none font-mono text-xs text-problem-text">L{b.line}</span>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{b.raw}</span>
                        <span className="rounded-full bg-problem-bg px-2.5 py-px text-xs text-problem-text">{REASONS[b.reason]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {bad.filter((b) => b.hour === null).map((b) => (
            <p key={b.line} className="rounded-control bg-problem-row px-4 py-2 text-sm text-problem-text">
              <span className="font-mono text-xs">L{b.line}</span> {b.raw} · {REASONS[b.reason]}
            </p>
          ))}

          {error && <p role="alert" className="rounded-control bg-problem-bg px-4 py-3 text-sm text-problem-text">{error}</p>}
          <button
            type="button"
            disabled={!ready || busy}
            onClick={submit}
            className="grid min-h-12 w-full place-items-center rounded-control border border-signal bg-signal px-5 text-[15px] font-semibold text-white disabled:opacity-60 sm:w-auto sm:self-start"
          >
            {busy ? "Drafting…" : "Draft package"}
          </button>
          {!ready && hint && <p className="text-[12.5px] text-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
