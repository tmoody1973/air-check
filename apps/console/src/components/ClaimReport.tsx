"use client";

import { useState } from "react";
import { verifyReport } from "@aircheck/core";
import { showDateLabel } from "@/lib/date";
import { embargoOf as trackHold, isOpenClaim, type ResearchView } from "@/lib/research";
import { ClaimLine, SourceChips } from "./ClaimLine";
import { Pill } from "./Pill";
import { type BlockActions, BlockControls, BlockPills, LABEL } from "./ShowNotesCard";

// Plan 7 pre-air verify, phone first: what is still open sits on top, then each change as "Now:" and "Change to:" with
// its own Copy, so Tarik can fix Paper line by line. The screen shows the plain line and its source chips; Copy puts the
// exact Paper Markdown (links appended by core) on the clipboard. Which lines get a replacement is core's verifyReport (code), never
// the model's call. Station play context is shown apart and labelled as context, not a claim.

const COPY_BTN = "inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-quiet";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ClaimReport({ view, today, actions }: { view: ResearchView; today: string; actions: BlockActions }) {
  const [said, setSaid] = useState({ text: "", n: 0 });
  const say = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));
  const lines = view.job.lines ?? [];
  const byKey = new Map(view.entries.map((e) => [e.key, e]));
  const trackOf = new Map(view.tracks.map((t) => [t.key, t]));
  const embargoOf = (lineId: string) => trackHold(trackOf.get(lines.find((l) => l.id === lineId)?.trackKey ?? ""));
  const { changes } = verifyReport({ lines, entries: view.entries, tracks: view.tracks });
  const open = lines.filter((l) => !l.closing).flatMap((l) => (byKey.get(l.id)?.claims ?? []).filter(isOpenClaim).map((c, i) => ({ id: l.id, c, i })));
  const context = view.job.playContext ?? [];

  async function copy(lineId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(`Copied the change for ${lineId}.`);
    } catch {
      say("Couldn't copy here. Select the text instead.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-soft">{plural(changes.length, "change")} · {open.length} open</p>

      <section aria-labelledby="open-h" className="rounded-card border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 id="open-h" className="font-serif text-[22px] leading-tight">Still open</h2>
          {open.length > 0 && <Pill tone="caution">{open.length} to check</Pill>}
        </div>
        {open.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-muted">Nothing open.</p>
        ) : (
          <ul aria-label="Still open">
            {open.map(({ id, c, i }) => (
              <li key={`${id}-${i}`} className="grid grid-cols-[44px_1fr] gap-2.5 border-t border-line px-5 py-3 text-sm">
                <span className="font-mono text-xs leading-5 text-muted">{id}</span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <BlockPills entry={byKey.get(id)} embargo={embargoOf(id)} today={today} />
                  <ClaimLine claim={c} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="changes-h" className="rounded-card border border-line bg-surface">
        <h2 id="changes-h" className="px-5 pb-2 pt-4 font-serif text-[22px] leading-tight">Changes</h2>
        {changes.length === 0 && <p className="px-5 pb-4 text-sm text-muted">No changes.</p>}
        {changes.map((ch) => (
          <article key={ch.lineId} className="flex flex-col gap-2.5 border-t border-line px-5 py-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted">{ch.lineId}</span>
              <BlockPills entry={byKey.get(ch.lineId)} embargo={embargoOf(ch.lineId)} today={today} />
            </div>
            <div className="flex flex-col gap-0.5">
              <p className={LABEL}>Now:</p>
              <p className="text-ink-soft [overflow-wrap:anywhere]">{ch.original}</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className={LABEL}>Change to:</p>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{ch.text}</p>
              <SourceChips sources={ch.sources} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4">
              <button type="button" className={COPY_BTN} onClick={() => copy(ch.lineId, ch.replacement)}>Copy</button>
              <BlockControls blockKey={ch.lineId} name={ch.lineId} entry={byKey.get(ch.lineId)} view={view} actions={actions} />
            </div>
          </article>
        ))}
      </section>

      {context.length > 0 && (
        <section aria-labelledby="context-h" className="rounded-card border border-line bg-surface px-5 py-4">
          <h2 id="context-h" className="text-sm font-semibold">Context, not a claim</h2>
          <p className="mt-1 text-[12.5px] text-muted">Station play history for 88nine and HYFIN. Nothing here is checked or changed.</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {context.map((p) => (
              <li key={`${p.artist}|${p.station}`} className="[overflow-wrap:anywhere]">
                {[p.artist, p.station, p.lastPlayed && `last played ${showDateLabel(p.lastPlayed)}`].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p role="status" className="sr-only">{said.text}{said.n % 2 ? " " : ""}</p>
    </div>
  );
}
