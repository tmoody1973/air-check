import { nextToDraft } from "@aircheck/core";
import { inBacklog, type IngestConvex } from "./convex.js";
import { factsOf } from "./disk.js";

export interface DraftDeps {
  convex: IngestConvex; log: (line: string) => void;
  /** The last outcome logged: the same "drafting" answer every minute is said once. */
  last: { key: string };
  /**
   * R14: nothing is drafted on half-read data: only after a scan that read every connected source. R5: nor while a scan
   * runs, nor while a save exists that the last scan never read (the minute pass rescans first).
   */
  scan: { lastScanComplete: boolean; scanning: boolean; seenRescanAfter: number };
}

/**
 * One pass: ask Convex to queue the oldest ready show's draft. Convex decides (idempotent per date, the pace of 3, two
 * failed drafts at most); this only picks the candidate, so two passes or two scans never queue two runs.
 */
export async function draftPass(deps: DraftDeps): Promise<void> {
  if (!deps.scan.lastScanComplete || deps.scan.scanning) return;
  const { episodes, awaitingReview, rescanAfter, extraDates } = await deps.convex.list();
  if (rescanAfter > deps.scan.seenRescanAfter) return;
  // R4: a show whose fix the scanner hasn't applied yet waits for its rescan, without holding up the shows behind it.
  // R5: a stale fix fell back to what Tarik rejected, so that show is never drafted until he fixes it again.
  // A removed 2025 date can keep its row (a correction, prune's cap); out of the backlog, it is never a candidate.
  const next = nextToDraft(episodes.filter((r) => inBacklog(r.showDate, extraDates) && !r.rescanPending && !r.corrected?.stale).map((r) => factsOf(r)), awaitingReview);
  if (!next) return;
  const t0 = Date.now();
  const r = await deps.convex.requestDraft(next.showDate);
  const outcome = r.queued ? `queued=true` : `queued=false reason=${r.reason.replace(/[^\w-]/g, "_")}`;
  const key = `${next.showDate} ${r.queued ? r.runId : outcome}`;
  if (key === deps.last.key) return;
  deps.last.key = key;
  deps.log(`ingest date=${next.showDate} step=draft ok=true ${outcome} ms=${Date.now() - t0}`);
}
