"use client";

import { useState } from "react";
import type { JudgedClaim } from "@aircheck/core";
import {
  embargoOf, isActive, isDoneEntry, isOpenClaim, isSample, progressOf, refusalText, type ResearchView, timeLeft, trackName,
} from "@/lib/research";
import { NEUTRAL_CHIP, VERIFY_CHIP } from "./ClaimLine";
import { LiveTag } from "./RunProgressCard";
import { SampleTag } from "./SampleTag";

// The approved live-progress card (.impeccable/mocks/decision/progress.webp), fed by research.get. Counts and time left
// are code's (Hard Rule 10). Code knows what is saved, not which key the agent is on, so the first open key reads "Next",
// never "Working". Take over stops now and keeps every saved block (ruling R1).

const TAKE_OVER = "Stops now. Everything saved so far stays.";
const RESUME = "Researches what is left. Blocks you edited are skipped.";
const VERIFY = "Checks these notes against their sources before air, as a new pre-air check.";
const KIND_WORDS: Record<JudgedClaim["kind"], string> = {
  release: "release", "release-date": "release date", label: "label", credit: "credit", "track-number": "track number",
  length: "length", bio: "bio", detail: "detail", thread: "thread", connection: "connection",
  chart: "chart", story: "story", song: "song", samples: "samples", video: "video", "fun-fact": "fun fact",
  lead: "lead", origins: "origins", career: "career", sound: "sound", records: "records", legacy: "legacy", infobox: "infobox",
};
const verifyChip = (c: JudgedClaim) => `[verify] ${KIND_WORDS[c.kind]}: ${c.status === "conflict" ? "sources disagree" : "could not verify"}`;
const BTN = "inline-flex min-h-11 items-center whitespace-nowrap rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-quiet disabled:text-muted";

function hostsOf(claims: JudgedClaim[]): string[] {
  return [...new Set(claims.flatMap((c) => c.sources.map((s) => s.host)))];
}

function Row({ label, status, current, children }: { label: string; status: React.ReactNode; current?: boolean; children: React.ReactNode }) {
  return (
    <li className={`grid grid-cols-[44px_1fr_auto] items-start gap-2.5 border-t border-line px-5 py-3 text-sm ${current ? "bg-paper" : ""}`}>
      <span className="font-mono text-xs leading-5 text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
      {status}
    </li>
  );
}

const word = (text: string, tone = "text-muted") => <span className={`whitespace-nowrap text-[12.5px] ${tone}`}>{text}</span>;

function TrackRows({ view }: { view: ResearchView }) {
  const byKey = new Map(view.entries.map((e) => [e.key, e]));
  const active = isActive(view.job.status);
  const next = active ? view.tracks.find((t) => !t.closing && !isDoneEntry(byKey.get(t.key)))?.key : undefined;
  return (
    <ul>
      {view.tracks.map((t) => {
        if (t.closing)
          return <Row key={t.key} label={t.key} status={word("Skipped")}><span className="text-muted [overflow-wrap:anywhere]">{trackName(t)} · closing track, no notes</span></Row>;
        const e = byKey.get(t.key);
        const done = isDoneEntry(e);
        const claims = e?.claims ?? [];
        const chips = [...hostsOf(claims).map((h) => ({ text: h, verify: false })), ...claims.filter(isOpenClaim).map((c) => ({ text: verifyChip(c), verify: true }))]
          .map((c, i) => ({ ...c, key: `${i}-${c.text}` }));
        const isNext = t.key === next;
        const status = done ? word("Done", "text-signal-deep") : isNext ? word("Next", "font-semibold text-ink") : word(active ? "Waiting" : "Not researched");
        return (
          <Row key={t.key} label={t.key} status={status} current={isNext}>
            <span className={`[overflow-wrap:anywhere] ${done || isNext ? "" : "text-muted"}`}>{trackName(t)}</span>
            {e?.edited && <span className="ml-2 text-[12.5px] text-ink-soft">· edited by you</span>}
            {/* research.get marks only embargoes active today: every human view says Private. */}
            {embargoOf(t) && <span className="ml-2 inline-block rounded-full bg-problem-bg px-2 py-px text-xs font-medium text-problem-text">Private</span>}
            {(chips.length > 0 || (isNext && view.lastStep)) && (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {chips.map((c) => <span key={c.key} className={c.verify ? VERIFY_CHIP : NEUTRAL_CHIP}>{c.text}</span>)}
                {isNext && view.lastStep && <span className={NEUTRAL_CHIP}>{view.lastStep}</span>}
              </span>
            )}
          </Row>
        );
      })}
    </ul>
  );
}

const TITLES = { "show-notes": ["Writing show notes", "Show notes"], verify: ["Checking the notes", "Pre-air check"], "deep-dive": ["Writing the deep dive", "Deep dive"] } as const;

export function ResearchProgress({ view, onTakeOver, onResume, onVerify, authReady = true }: {
  view: ResearchView;
  onTakeOver: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  /** I3: start a pre-air check of these show notes (done show notes only; never the sample). */
  onVerify?: () => Promise<unknown>;
  /** False until Convex has the Clerk token. */
  authReady?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, kind } = view.job;
  const active = isActive(status);
  const sample = isSample(view);
  const p = progressOf(view);
  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  // Every open block counts (intros and threads too), not only the track rows shown.
  const left = view.progress.total - view.progress.done;
  // Work left after done happens only after a retarget (server-only for now).
  const canResume = !active && !sample && left > 0;
  const canVerify = !!onVerify && kind === "show-notes" && status === "done" && !sample;
  const byKey = new Map(view.entries.map((e) => [e.key, e]));
  const nextHour = active ? view.tracks.find((t) => !t.closing && !isDoneEntry(byKey.get(t.key)))?.hour : undefined;
  const title = `${TITLES[kind][active ? 0 : 1]}${kind === "show-notes" && nextHour ? ` · Hour ${nextHour}` : ""}`;

  async function act(run: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try { await run(); } catch (e) { setError(refusalText(e)); } finally { setPending(false); }
  }

  return (
    <section aria-label="Progress" className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <h2 className="font-serif text-[22px] leading-tight">{title}</h2>
        {sample ? <SampleTag /> : <LiveTag />}
      </div>
      <div role="progressbar" aria-label="Research done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="relative mx-5 h-1 rounded-sm bg-surface-quiet">
        <i className="absolute inset-y-0 left-0 rounded-sm bg-signal" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 px-5 pb-3 pt-2.5 text-[13px] text-muted">
        <p aria-live="polite">{p.line}</p>
        {active && view.secondsLeft !== undefined && <p>{timeLeft(view.secondsLeft)}</p>}
      </div>
      {kind === "show-notes" && status !== "done" && <TrackRows view={view} />}
      {kind !== "show-notes" && active && view.lastStep && (
        <p className="border-t border-line px-5 py-3"><span className={NEUTRAL_CHIP}>{view.lastStep}</span></p>
      )}
      {(active || canResume || canVerify) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5">
          {active ? (
            <button type="button" className={BTN} disabled={pending || !authReady} onClick={() => act(onTakeOver)}>Take over</button>
          ) : canResume && (
            <button type="button" className={BTN} disabled={pending || !authReady} onClick={() => act(onResume)}>Resume</button>
          )}
          {canVerify && <button type="button" className={BTN} disabled={pending || !authReady} onClick={() => act(onVerify)}>Pre-air verify</button>}
          <span className="min-w-0 flex-1 basis-56 text-[13px] text-muted">
            {!authReady ? "Signing you in…" : status === "queued" ? `Waiting for the agent… ${TAKE_OVER}` : active ? TAKE_OVER : canResume ? RESUME : VERIFY}
          </span>
          {error && <p role="alert" className="basis-full text-sm text-problem-text">{error}</p>}
        </div>
      )}
      <p className="border-t border-line px-5 pb-3.5 pt-2.5 font-mono text-[11px] leading-snug text-muted">
        {sample ? "Sample report · placeholders, not real releases" : active ? "Live from the agent's run · steps stream in as they happen" : "Recorded from the agent's run"}
      </p>
    </section>
  );
}
