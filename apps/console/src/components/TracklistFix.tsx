import { parseDriveTracklist } from "@aircheck/core";
import { useEffect, useMemo, useState } from "react";
import { showDateLabel } from "../lib/date";
import { PRIMARY, SECONDARY, useSave, type RowCtx } from "./EpisodeControls";
import { TracklistPreview } from "./TracklistEditor";

// Plan 6b: "Fix the tracklist" / "Edit tracklist" on an Episodes row. The text is saved in Air Check as the show's
// correction and used exactly as typed; Drive is never changed (decision 017). Same line rule as the scanner.

// Mirrors corrections.ts; the server stays the authority.
const MAX_CHARS = 20_000;
const MAX_TRACKS = 100;
export const CHECKING = "Saved. Checking again in a minute or two.";

export function TracklistFix({ showDate, ctx, onClose }: { showDate: string; ctx: RowCtx; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { busy, error, save } = useSave(ctx.announce);
  const { tracklistText } = ctx.actions;

  // Loaded once per open. The page rebuilds `actions` every render, so it is not a dependency: re-reading would
  // throw away what Tarik is typing.
  useEffect(() => {
    let live = true;
    tracklistText(showDate).then(
      (t) => live && setText(t),
      () => {
        if (!live) return;
        setLoadFailed(true);
        setText("");
      },
    );
    return () => {
      live = false;
    };
  }, [showDate]);

  const { tracks, bad } = useMemo(() => parseDriveTracklist(text ?? ""), [text]);
  const empty = ([1, 2] as const).some((h) => !tracks.some((t) => t.hour === h));
  const tooLong = (text?.length ?? 0) > MAX_CHARS || tracks.length > MAX_TRACKS;
  const ready = text !== null && bad.length === 0 && !empty && !tooLong;
  const hint = [empty && "Both hours need at least one track.", bad.length > 0 && "Fix the flagged lines.", tooLong && "That is longer than a show can hold."].filter(Boolean).join(" ");
  const date = showDateLabel(showDate);
  const id = `fix-tl-${showDate}`;

  const submit = async () => {
    const typed = text;
    if (ready && typed !== null && (await save(() => ctx.actions.setTracklist({ showDate, text: typed }), CHECKING))) onClose();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2">
          <label htmlFor={id} className="font-medium">Tracklist for {date}</label>
          <p className="text-ink-soft">Air Check uses this instead of the Drive doc. Drive isn&apos;t changed.</p>
          {loadFailed && <p className="text-muted">The saved tracklist couldn&apos;t be loaded. You can type it here.</p>}
          <textarea
            id={id}
            value={text ?? ""}
            disabled={text === null}
            placeholder={text === null ? "Loading…" : undefined}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="min-h-64 w-full resize-y rounded-control border border-line-strong bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal"
          />
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          <TracklistPreview text={text ?? ""} drive />
        </div>
      </div>
      {error && <p role="alert" className="text-problem-text">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!ready || busy} onClick={submit}>Save tracklist</button>
        <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
        {text !== null && !ready && hint && <p className="text-[12.5px] text-muted">{hint}</p>}
      </div>
    </div>
  );
}
