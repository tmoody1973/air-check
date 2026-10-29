"use client";

import { chicagoTimeLabel } from "../lib/date";
import { SECONDARY, useSave } from "./EpisodeControls";
import { Pill, type PillTone } from "./Pill";

// Plan 8: why an email made no record (radar.notAdded, real workspace only). The From header and subject are the
// sender's own words, so they are plain text: no link, no href, no HTML, no auto-linking (Task 3). Never the body.

export type NotAddedRow = {
  messageId: string;
  receivedAt: number;
  from: string;
  subject: string;
  state: "received" | "saved" | "merged" | "not-a-release" | "refused" | "ignored" | "failed";
  tab?: "bandcamp" | "cosign";
  reasons: string[];
};

const STATE: Record<NotAddedRow["state"], [PillTone, string]> = {
  received: ["neutral", "Waiting"],
  saved: ["ready", "Saved"],
  merged: ["ready", "Merged"],
  "not-a-release": ["neutral", "Not a release"],
  refused: ["caution", "Not read"],
  ignored: ["neutral", "Ignored"],
  failed: ["problem", "Failed"],
};
const RETRYABLE = new Set<NotAddedRow["state"]>(["refused", "failed"]);

function Row({ row, retry, announce }: { row: NotAddedRow; retry: (a: { messageId: string }) => Promise<unknown>; announce: (msg: string) => void }) {
  const { busy, error, save } = useSave(announce);
  const [tone, word] = STATE[row.state];
  const waiting = row.reasons.includes("Waiting to be read");
  const reasons = row.state === "received" && row.reasons.length === 0 ? ["Being read now"] : row.reasons;
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-3 text-sm first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] text-muted tabular-nums">{chicagoTimeLabel(new Date(row.receivedAt).toISOString())}</span>
        <Pill tone={tone}>{word}</Pill>
      </div>
      <p className="font-medium [overflow-wrap:anywhere]">{row.from}</p>
      <p className="text-ink-soft [overflow-wrap:anywhere]">{row.subject}</p>
      {reasons.map((r, i) => <p key={i} className="[overflow-wrap:anywhere]">{r}</p>)}
      {waiting && <p className="text-muted">Older than 10 minutes: the ingest worker may be down.</p>}
      {RETRYABLE.has(row.state) && (
        <button type="button" className={`${SECONDARY} mt-1 self-start`} disabled={busy} onClick={() => save(() => retry({ messageId: row.messageId }), "Sent back to be read again")}>
          Try again
        </button>
      )}
      {error && <p role="alert" className="text-problem-text">{error}</p>}
    </li>
  );
}

export function RadarNotAdded({ rows, retry, announce }: { rows: NotAddedRow[]; retry: (a: { messageId: string }) => Promise<unknown>; announce: (msg: string) => void }) {
  return (
    <section aria-labelledby="not-added" className="rounded-card border border-line bg-surface p-5">
      <h2 id="not-added" className="text-base font-semibold">Not added</h2>
      <p className="mt-1 text-sm text-muted">Emails that made no record, and why. The newest 50.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Every email so far made a record.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => <Row key={r.messageId} row={r} retry={retry} announce={announce} />)}
        </ul>
      )}
    </section>
  );
}
