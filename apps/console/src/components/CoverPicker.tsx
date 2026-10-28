"use client";

import { useEffect, useRef, useState } from "react";
import { coverProblem, type CoverChangeResult } from "../lib/cover";

export type CoverChangeFn = (file: File) => Promise<CoverChangeResult>;

type Note = { tone: "busy" | "changed" | "problem"; text: string };
const NOTE_CLASS = { busy: "text-muted", changed: "text-caution-text font-medium", problem: "text-problem-text" } as const;

/**
 * The cover that goes public with the show. While the package awaits review a new image can replace it; that
 * re-fingerprints the package, so the host reviews it again. Read-only once decided.
 */
export function CoverPicker({ url, custom, onChange }: {
  url: string | null;
  custom: boolean;
  /** Absent when the cover can't change (decided, or the package changed under the host). */
  onChange?: CoverChangeFn;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const previewRef = useRef<string | null>(null);
  const swapPreview = (next: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next;
    setPreview(next);
  };
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  async function pick(file: File | undefined) {
    if (!file || !onChange) return;
    const problem = coverProblem(file);
    if (problem) return setNote({ tone: "problem", text: problem });
    swapPreview(URL.createObjectURL(file));
    setNote({ tone: "busy", text: "Uploading…" });
    const res = await onChange(file).catch(() => ({ ok: false, message: "The upload failed. Try again." }) as const);
    if (res.ok) setNote({ tone: "changed", text: "Changed: review again" });
    else {
      swapPreview(null);
      setNote({ tone: "problem", text: res.message });
    }
  }

  const src = preview ?? url;
  const busy = note?.tone === "busy";
  return (
    <section aria-label="Cover" className="flex items-center gap-4 rounded-card border border-line bg-surface p-4">
      <div className="size-20 flex-none overflow-hidden rounded-control border border-line bg-surface-quiet">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL or a local blob preview
          <img src={src} alt="Cover" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center font-mono text-[11px] tracking-[0.1em] text-muted uppercase">None</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <p className="text-sm font-medium">{src ? (custom || preview ? "Your image" : "Standard cover") : "No cover yet"}</p>
        {note && (
          <p role={note.tone === "problem" ? "alert" : "status"} className={`text-[12.5px] ${NOTE_CLASS[note.tone]}`}>{note.text}</p>
        )}
        {onChange && (
          <label
            className={`inline-flex min-h-11 cursor-pointer items-center whitespace-nowrap rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-quiet has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = ""; // picking the same file again still fires
                void pick(file);
              }}
            />
            Use a different image
          </label>
        )}
      </div>
    </section>
  );
}
