import { episodeStatus, type LinkedPackageStatus } from "@aircheck/core";
import type { Correction, DraftOutcome, IngestConvex, IngestRow, Placement, ScannedEpisode, SourceReport, Unplaced } from "../src/convex.js";

/**
 * In-memory stand-in for apps/console/convex/ingest.ts with the same rules that matter here: upsert replaces the scanned
 * facts, list never returns the notes text, requestDraft is idempotent per date (an open run means "drafting"), counts
 * open runs in the pace, stops after two finished runs (R10), and prunes like ingest.prune (I3).
 * Plan 6b: Tarik's corrections and placements, `rescanAfter` (the newest save or undo), reportUnplaced, and R4's
 * rescan-pending rule (a show waits for the scan that applied its latest fix or placement).
 */
export function fakeConvex() {
  const rows = new Map<string, ScannedEpisode>();
  const extra = new Map<string, Partial<IngestRow>>();
  const packages = new Map<string, LinkedPackageStatus>();
  const runs: { showDate: string; open: boolean }[] = [];
  const upserts: ScannedEpisode[] = [];
  const fetches: { showDate: string; status: string; error?: string }[] = [];
  const draftCalls: { showDate: string; outcome: DraftOutcome }[] = [];
  const sources: SourceReport[] = [];
  const prunes: string[][] = [];
  const corrections = new Map<string, Correction>();
  const placements: (Placement & { updatedAt: number })[] = [];
  const unplacedReports: Unplaced[][] = [];
  const scannedAt = new Map<string, number>();
  let undoneAt = 0;
  let awaitingExtra = 0;

  const rescanPending = (e: ScannedEpisode) =>
    (corrections.get(e.showDate)?.updatedAt ?? 0) !== (e.appliedCorrectionAt ?? 0) ||
    placements.some((p) => p.date === e.showDate && p.updatedAt > (scannedAt.get(e.showDate) ?? 0));

  const rowOf = (e: ScannedEpisode): IngestRow => {
    const { notes: { text, ...notes }, tracklist: { tracks, ...tracklist }, ...rest } = e;
    void text;
    const runsFor = runs.filter((r) => r.showDate === e.showDate);
    const base = { ...rest, notes, tracklist, ...(tracks && { tracks }), packageStatus: packages.get(e.showDate) ?? "none", draftAttempts: runsFor.filter((r) => !r.open).length, rescanPending: rescanPending(e), ...extra.get(e.showDate) } as IngestRow;
    return { ...base, ...episodeStatus({ ...base, questions: base.questions }) };
  };

  const convex: IngestConvex = {
    async list() {
      const open = runs.filter((r) => r.open).length;
      const waiting = [...packages.values()].filter((s) => s === "awaiting_review" || s === "preparing_audio").length;
      const rescanAfter = Math.max(0, undoneAt, ...[...corrections.values()].map((c) => c.updatedAt), ...placements.map((p) => p.updatedAt));
      return {
        episodes: [...rows.values()].sort((a, b) => a.showDate.localeCompare(b.showDate)).map(rowOf), awaitingReview: open + waiting + awaitingExtra,
        corrections: [...corrections.values()].map((c) => structuredClone(c)), placements: placements.map(({ source, id, date }) => ({ source, id, date })), rescanAfter,
      };
    },
    async upsert(e) {
      upserts.push(structuredClone(e));
      // Answers and rerun marks are kept by the real upsert; here they live in `extra`.
      rows.set(e.showDate, structuredClone(e));
      scannedAt.set(e.showDate, Date.now());
    },
    async setFetch(showDate, status, error) {
      fetches.push({ showDate, status, ...(error ? { error } : {}) });
    },
    async requestDraft(showDate) {
      const row = rows.get(showDate);
      let outcome: DraftOutcome;
      const mine = runs.filter((r) => r.showDate === showDate);
      const status = row ? rowOf(row).status : "not-found";
      if (mine.some((r) => r.open)) outcome = { queued: false, reason: "drafting" };
      else if (row && rescanPending(row)) outcome = { queued: false, reason: "rescan-pending" };
      else if (status !== "ready-to-draft") outcome = { queued: false, reason: status };
      else if ((await convex.list()).awaitingReview >= 3) outcome = { queued: false, reason: "pace" };
      else {
        runs.push({ showDate, open: true });
        outcome = { queued: true, runId: `run-${runs.length}` };
      }
      draftCalls.push({ showDate, outcome });
      return outcome;
    },
    async sourceStatus(r) {
      sources.push(r);
    },
    async reportUnplaced(items) {
      unplacedReports.push(structuredClone(items));
    },
    async prune(keep) {
      prunes.push([...keep]);
      const gone = [...rows.keys()].filter((d) => !keep.includes(d) && !packages.has(d) && !extra.get(d)?.rerunOf);
      if (gone.length > 3) return { deleted: 0, skipped: gone.length };
      for (const d of gone) rows.delete(d);
      return { deleted: gone.length };
    },
  };
  return {
    convex, rows, extra, packages, runs, upserts, fetches, draftCalls, sources, prunes, corrections, placements, unplacedReports,
    setAwaiting: (n: number) => void (awaitingExtra = n),
    /** A clear or unplace: nothing left to compare, but the scan must still run (ingest.ts's rescanAsks). */
    undo: (at: number) => void (undoneAt = at),
    lastSource: (s: SourceReport["source"]) => sources.filter((x) => x.source === s).at(-1),
  };
}
