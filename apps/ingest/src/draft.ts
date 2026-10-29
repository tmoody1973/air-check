import { nextToDraft } from "@aircheck/core";
import type { IngestConvex } from "./convex.js";
import { factsOf } from "./disk.js";

export interface DraftDeps {
  convex: IngestConvex; log: (line: string) => void;
  /** The last outcome logged: the same "drafting" answer every minute is said once. */
  last: { key: string };
  /** R14: nothing is drafted on half-read data: only after a scan that read every connected source. */
  scan: { lastScanComplete: boolean };
}

/**
 * One pass: ask Convex to queue the oldest ready show's draft. Convex decides (idempotent per date, the pace of 3, two
 * failed drafts at most); this only picks the candidate, so two passes or two scans never queue two runs.
 */
export async function draftPass(deps: DraftDeps): Promise<void> {
  if (!deps.scan.lastScanComplete) return;
  const { episodes, awaitingReview } = await deps.convex.list();
  const next = nextToDraft(episodes.map((r) => factsOf(r)), awaitingReview);
  if (!next) return;
  const t0 = Date.now();
  const r = await deps.convex.requestDraft(next.showDate);
  const outcome = r.queued ? `queued=true` : `queued=false reason=${r.reason.replace(/[^\w-]/g, "_")}`;
  const key = `${next.showDate} ${r.queued ? r.runId : outcome}`;
  if (key === deps.last.key) return;
  deps.last.key = key;
  deps.log(`ingest date=${next.showDate} step=draft ok=true ${outcome} ms=${Date.now() - t0}`);
}
