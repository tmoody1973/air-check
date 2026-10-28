"use client";

import { checkDescription, describeIssue, type PackageDraft, type PackageRecord } from "@aircheck/core";
import { useId, useState } from "react";

export type DescriptionSaveResult = { ok: true; record: PackageRecord } | { ok: false; message: string };
export type DescriptionSaveFn = (text: string) => Promise<DescriptionSaveResult>;

const LIMIT = 999; // "under 1,000 characters", in code points, like the checker
const codePoints = (s: string) => [...s].length;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const BTN = "inline-flex min-h-11 items-center whitespace-nowrap rounded-control px-4 text-sm font-semibold disabled:opacity-60";

type Note = { tone: "busy" | "changed" | "problem"; text: string };
const NOTE_CLASS = { busy: "text-muted", changed: "text-caution-text font-medium", problem: "text-problem-text" } as const;

/**
 * The public description, its private sources, and (while the package awaits review) an editor. The checker runs as
 * the host types; private terms live on the server, so those are caught on Save. Saving re-fingerprints the package,
 * so the host reviews it again. Read-only when `onSave` is absent (decided, stale, or the demo).
 */
export function DescriptionEditor({ draft, onSave }: { draft: PackageDraft; onSave?: DescriptionSaveFn }) {
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const id = useId();
  const editing = text !== null && !!onSave;
  const issues = editing ? checkDescription(text, { trackTitles: draft.tracks.map((t) => t.title), privateTerms: [] }).map(describeIssue) : [];
  const busy = note?.tone === "busy";
  const n = codePoints(text ?? draft.description);

  async function save() {
    if (text === null || !onSave) return;
    setNote({ tone: "busy", text: "Saving…" });
    const res = await onSave(text).catch(() => ({ ok: false, message: "Saving failed. Try again." }) as const);
    if (res.ok) {
      setText(null);
      setNote({ tone: "changed", text: "Changed: review again" });
    } else setNote({ tone: "problem", text: sentence(res.message) });
  }

  return (
    <div className="flex flex-col gap-2">
      {editing ? (
        <>
          <label htmlFor={id} className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">Description</label>
          <textarea
            id={id}
            value={text}
            rows={7}
            disabled={busy}
            onChange={(e) => setText(e.currentTarget.value)}
            aria-describedby={`${id}-count`}
            className="w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] leading-[1.55] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
          <p id={`${id}-count`} className={`font-mono text-xs tabular-nums ${n > LIMIT ? "text-problem-text" : "text-muted"}`}>{n} / {LIMIT}</p>
          {issues.length > 0 && (
            <ul aria-live="polite" className="flex flex-col gap-1">
              {issues.map((i) => (
                <li key={i} className="rounded-control bg-caution-bg px-3 py-2 text-[12.5px] text-caution-text [overflow-wrap:anywhere]">{sentence(i)}</li>
              ))}
            </ul>
          )}
          {note && note.tone !== "changed" && (
            <p role={note.tone === "problem" ? "alert" : "status"} className={`text-[12.5px] ${NOTE_CLASS[note.tone]}`}>{note.text}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || issues.length > 0 || text === draft.description}
              onClick={() => void save()}
              className={`${BTN} border border-line-strong bg-surface text-ink hover:bg-surface-quiet`}
            >
              {busy ? "Saving…" : "Save description"}
            </button>
            <button type="button" disabled={busy} onClick={() => (setText(null), setNote(null))} className={`${BTN} text-ink-soft`}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{draft.description}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="font-mono text-xs text-muted">{n} characters</p>
            {note?.tone === "changed" && <p role="status" className={`text-[12.5px] ${NOTE_CLASS.changed}`}>{note.text}</p>}
            {onSave && (
              <button
                type="button"
                onClick={() => (setText(draft.description), setNote(null))}
                className="min-h-11 text-sm font-medium text-signal underline-offset-2 hover:underline"
              >
                Edit description
              </button>
            )}
          </div>
        </>
      )}
      {(draft.descriptionSources?.length ?? 0) > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted">Sources (not published)</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {draft.descriptionSources!.map((s, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <span className="text-ink-soft">{s.claim}</span>
                <span className="block font-mono text-xs text-muted">{s.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
