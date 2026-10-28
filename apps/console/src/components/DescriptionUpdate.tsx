"use client";

import { checkDescription, describeIssue } from "@aircheck/core";
import { useId, useState, type ReactNode } from "react";
import { chicagoTimeLabel } from "../lib/date";

type Sources = { claim: string; source: string }[];
/** descriptionUpdates.forPackage's answer: what Mixcloud shows now, and the latest update. */
export type UpdateView = {
  live: { description: string; descriptionSources?: Sources; updatedAt?: string };
  latest: {
    id: string; status: "proposed" | "approved" | "pushing" | "pushed" | "failed"; description: string;
    proposedBy: "agent" | "human"; fingerprint: string; descriptionSources?: Sources; error?: string; pushedAt?: string; approvedAt?: string;
  } | null;
};
type Refused = { ok: false; message: string };
export type UpdateFns = {
  propose: (text: string) => Promise<{ ok: true; replaced: boolean } | Refused>;
  approve: (id: string, fingerprint: string) => Promise<{ ok: true } | Refused>;
};

const LIMIT = 999; // "under 1,000 characters", in code points, like the checker
const codePoints = (s: string) => [...s].length;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const BTN = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-control px-4 text-sm font-semibold disabled:opacity-60";
const PRIMARY = `${BTN} bg-signal text-white`;
const SECONDARY = `${BTN} border border-line-strong bg-surface text-ink hover:bg-surface-quiet`;
const CAPTION = "font-mono text-[11px] tracking-[0.1em] text-muted uppercase";

/** The publisher's short codes in plain words. Anything else (Mixcloud's own code) shows as written. */
const FAILURE: Record<string, string> = {
  retries_exhausted: "Mixcloud didn't answer after 3 tries. The old description is probably still up.",
  unconfirmed: "Mixcloud accepted the request but didn't confirm it. Check the show page — the new description may already be live.",
  bad_show_url: "The show's address on the receipt isn't one Air Check can edit. Nothing was sent.",
  not_published: "This show isn't marked as on Mixcloud any more. Nothing was sent.",
};

function Text({ caption, text, sources }: { caption: string; text: string; sources?: Sources }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className={CAPTION}>{caption}</p>
      <p className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{text}</p>
      <p className="font-mono text-xs text-muted tabular-nums">{codePoints(text)} characters</p>
      {(sources?.length ?? 0) > 0 && (
        <div className="mt-1">
          <p className="text-xs text-muted">Sources (not published)</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {sources!.map((s, i) => (
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

function Notice({ tone, children }: { tone: "quiet" | "problem"; children: ReactNode }) {
  const cls = tone === "problem" ? "bg-problem-bg text-problem-text" : "bg-surface-quiet text-ink-soft";
  return <div role={tone === "problem" ? "alert" : "status"} className={`rounded-control px-4 py-3 text-sm [overflow-wrap:anywhere] ${cls}`}>{children}</div>;
}

/** The proposal box: checked as the host types (private terms are checked on the server), then proposed. */
function Proposer({ start, live, trackTitles, propose, onProposed, onCancel }: {
  start: string; live: string; trackTitles: string[]; propose: UpdateFns["propose"]; onProposed: () => void; onCancel: () => void;
}) {
  const [text, setText] = useState(start);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const issues = checkDescription(text, { trackTitles, privateTerms: [] }).map(describeIssue);
  const n = codePoints(text);

  async function send() {
    setBusy(true);
    setProblem(null);
    const res = await propose(text).catch((): Refused => ({ ok: false, message: "Proposing failed. Try again." }));
    setBusy(false);
    if (res.ok) onProposed();
    else setProblem(sentence(res.message));
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={CAPTION}>New description</label>
      <textarea
        id={id} value={text} rows={7} disabled={busy} aria-describedby={`${id}-count`}
        onChange={(e) => setText(e.currentTarget.value)}
        className="w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] leading-[1.55] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      />
      <p id={`${id}-count`} className={`font-mono text-xs tabular-nums ${n > LIMIT ? "text-problem-text" : "text-muted"}`}>{n} / {LIMIT}</p>
      {issues.length > 0 && (
        <ul aria-live="polite" className="flex flex-col gap-1">
          {issues.map((i) => <li key={i} className="rounded-control bg-caution-bg px-3 py-2 text-[12.5px] text-caution-text [overflow-wrap:anywhere]">{sentence(i)}</li>)}
        </ul>
      )}
      {problem && <p role="alert" className="text-[12.5px] text-problem-text">{problem}</p>}
      <p className="text-[12.5px] text-ink-soft">Proposing doesn&apos;t change Mixcloud. You approve it next.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || issues.length > 0 || text.trim() === "" || text === live} onClick={() => void send()} className={PRIMARY}>
          {busy ? "Proposing…" : "Propose update"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={`${BTN} text-ink-soft`}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Plan 5c Task 4: the description of a show already on Mixcloud. The host (or the agent) proposes new text; the host
 * approves exactly the text on screen (its fingerprint); the publisher sends only the description.
 */
export function DescriptionUpdate({ view, trackTitles, fns }: { view: UpdateView; trackTitles: string[]; fns: UpdateFns }) {
  const { live, latest } = view;
  const [editing, setEditing] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Pin the proposal the host is reading: one replaced underneath (the agent re-proposed) needs a Reload first.
  const proposal = latest?.status === "proposed" ? latest : null;
  const [pinned, setPinned] = useState(proposal);
  if (proposal && !pinned) setPinned(proposal);
  if (!proposal && pinned) setPinned(null); // approved here or elsewhere: follow it
  const shown = proposal && pinned;
  const changed = !!shown && !!proposal && (proposal.id !== shown.id || proposal.fingerprint !== shown.fingerprint);
  const sending = latest?.status === "approved" || latest?.status === "pushing";

  async function approve() {
    if (!shown || changed) return;
    setApproving(true);
    setProblem(null);
    const res = await fns.approve(shown.id, shown.fingerprint).catch((): Refused => ({ ok: false, message: "Something went wrong. Try again." }));
    setApproving(false);
    if (!res.ok) setProblem(res.message);
  }

  return (
    <section aria-labelledby="mixcloud-description" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="mixcloud-description" className="text-base font-semibold">Description on Mixcloud</h3>
        {live.updatedAt && <p className="font-mono text-xs text-muted">Updated {chicagoTimeLabel(live.updatedAt)}</p>}
      </div>

      {editing !== null ? (
        <>
          <Text caption="Live on Mixcloud" text={live.description} />
          <Proposer
            start={editing} live={live.description} trackTitles={trackTitles} propose={fns.propose}
            // Convex shows the new proposal before the mutation resolves: pin it afresh, not the one it replaced.
            onProposed={() => (setEditing(null), setPinned(null))} onCancel={() => setEditing(null)}
          />
        </>
      ) : shown ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Text caption="Live on Mixcloud" text={live.description} sources={live.descriptionSources} />
            <div className="rounded-control border border-line-strong p-3">
              <Text caption={shown.proposedBy === "agent" ? "Proposed by the agent" : "Proposed by you"} text={shown.description} sources={shown.descriptionSources} />
            </div>
          </div>
          <p className="text-[12.5px] text-ink-soft">Only the description changes. Title, tags, cover and tracklist stay as they are.</p>
          {(changed || problem) && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-control bg-problem-bg px-4 py-3 text-problem-text">
              <span className="min-w-0 flex-1">{changed ? "This proposal changed. Open the latest version." : problem}</span>
              {changed && (
                <button type="button" onClick={() => (setPinned(proposal), setProblem(null))} className="min-h-11 rounded-control border border-problem-text px-4 font-medium">Reload</button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={changed || approving} onClick={() => void approve()} className={PRIMARY}>
              {approving ? "Approving…" : "Approve update"}
            </button>
            <button type="button" disabled={approving} onClick={() => setEditing(shown.description)} className={SECONDARY}>Edit proposal</button>
          </div>
        </>
      ) : (
        <>
          <Text caption="Live on Mixcloud" text={live.description} sources={live.descriptionSources} />
          {sending && <Notice tone="quiet">Updating on Mixcloud…</Notice>}
          {latest?.status === "failed" && (
            <Notice tone="problem">
              <p className="font-medium">{(latest.error && FAILURE[latest.error]) || `Mixcloud refused the update (${latest.error ?? "no reason given"}).`}</p>
              <button type="button" onClick={() => setEditing(latest.description)} className="mt-3 min-h-11 rounded-control border border-problem-text px-4 font-medium">
                Propose again
              </button>
            </Notice>
          )}
          {!sending && latest?.status !== "failed" && (
            <div>
              <button type="button" onClick={() => setEditing(live.description)} className={SECONDARY}>Update the description on Mixcloud</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
