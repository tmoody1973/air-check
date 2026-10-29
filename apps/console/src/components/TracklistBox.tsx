"use client";

import { formatTracklist, parseTracklist, type PackageDraft } from "@aircheck/core";
import { useId, useMemo, useState } from "react";
import type { DescriptionSaveResult } from "./DescriptionEditor";
import { TracklistPreview } from "./TracklistEditor";

// R7: the package page's tracklist, and (while the package awaits review) "Edit tracklist" beside Edit description.
// Read like the Tracklist page's text (same parser and cap); Convex also checks the title's lead artists are still in
// it. Saving re-fingerprints, so the host reviews the package again. The agent can never change a track (R6).

export type TracklistSaveFn = (text: string) => Promise<DescriptionSaveResult>;

const MAX_TRACKLIST = 50_000; // mirrors convex/tracklist.ts; the server stays the authority
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const BTN = "inline-flex min-h-11 items-center whitespace-nowrap rounded-control px-4 text-sm font-semibold disabled:opacity-60";

type Note = { tone: "busy" | "changed" | "problem"; text: string };

/** Read-only when `onSave` is absent (decided, stale, or the demo). */
export function TracklistBox({ draft, onSave }: { draft: PackageDraft; onSave?: TracklistSaveFn }) {
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const id = useId();
  const editing = text !== null && !!onSave;
  const { tracks, bad } = useMemo(() => parseTracklist(text ?? ""), [text]);
  const busy = note?.tone === "busy";
  const ready = editing && bad.length === 0 && ([1, 2] as const).every((h) => tracks.some((t) => t.hour === h)) && text.length <= MAX_TRACKLIST;

  async function save() {
    if (text === null || !onSave) return;
    setNote({ tone: "busy", text: "Saving…" });
    const res = await onSave(text).catch(() => ({ ok: false, message: "Saving failed. Try again." }) as const);
    if (res.ok) {
      setText(null);
      setNote({ tone: "changed", text: "Changed: review again" });
    } else setNote({ tone: "problem", text: sentence(res.message) });
  }

  if (editing)
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">Tracklist</label>
        <textarea
          id={id}
          value={text}
          rows={12}
          disabled={busy}
          spellCheck={false}
          onChange={(e) => setText(e.currentTarget.value)}
          className="w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        />
        <TracklistPreview text={text} />
        {note && note.tone !== "changed" && (
          <p role={note.tone === "problem" ? "alert" : "status"} className={`text-[12.5px] ${note.tone === "problem" ? "text-problem-text" : "text-muted"}`}>{note.text}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !ready || text === formatTracklist(draft.tracks)}
            onClick={() => void save()}
            className={`${BTN} border border-line-strong bg-surface text-ink hover:bg-surface-quiet`}
          >
            {busy ? "Saving…" : "Save tracklist"}
          </button>
          <button type="button" disabled={busy} onClick={() => (setText(null), setNote(null))} className={`${BTN} text-ink-soft`}>
            Cancel
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1">
        {draft.tracks.map((t) => (
          <li key={`${t.hour}-${t.position}`} className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono text-xs text-muted">{t.hour}.{t.position}</span>
            <span className="[overflow-wrap:anywhere]">{t.artist} – {t.title}{t.feat ? ` feat. ${t.feat}` : ""}</span>
            {t.closing && <span className="rounded-full bg-chip px-2 py-0.5 text-xs text-ink-soft">closing track</span>}
          </li>
        ))}
      </ol>
      {(note?.tone === "changed" || onSave) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {note?.tone === "changed" && <p role="status" className="text-[12.5px] font-medium text-caution-text">{note.text}</p>}
          {onSave && (
            <button
              type="button"
              onClick={() => (setText(formatTracklist(draft.tracks)), setNote(null))}
              className="min-h-11 text-sm font-medium text-signal underline-offset-2 hover:underline"
            >
              Edit tracklist
            </button>
          )}
        </div>
      )}
    </div>
  );
}
