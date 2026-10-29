import { episodeStatus, type LinkedPackageStatus } from "@aircheck/core";
import type { DraftOutcome, IngestConvex, IngestRow, ScannedEpisode, SourceReport } from "../src/convex.js";

/**
 * In-memory stand-in for apps/console/convex/ingest.ts with the same rules that matter here: upsert replaces the scanned
 * facts, list never returns the notes text, requestDraft is idempotent per date (an open run means "drafting"), counts
 * open runs in the pace, stops after two finished runs (R10), and prunes like ingest.prune (I3).
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
  let awaitingExtra = 0;

  const rowOf = (e: ScannedEpisode): IngestRow => {
    const { notes: { text, ...notes }, tracklist: { tracks, ...tracklist }, ...rest } = e;
    void text;
    const runsFor = runs.filter((r) => r.showDate === e.showDate);
    const base = { ...rest, notes, tracklist, ...(tracks && { tracks }), packageStatus: packages.get(e.showDate) ?? "none", draftAttempts: runsFor.filter((r) => !r.open).length, ...extra.get(e.showDate) } as IngestRow;
    return { ...base, ...episodeStatus({ ...base, questions: base.questions }) };
  };

  const convex: IngestConvex = {
    async list() {
      const open = runs.filter((r) => r.open).length;
      const waiting = [...packages.values()].filter((s) => s === "awaiting_review" || s === "preparing_audio").length;
      return { episodes: [...rows.values()].sort((a, b) => a.showDate.localeCompare(b.showDate)).map(rowOf), awaitingReview: open + waiting + awaitingExtra };
    },
    async upsert(e) {
      upserts.push(structuredClone(e));
      // Answers and rerun marks are kept by the real upsert; here they live in `extra`.
      rows.set(e.showDate, structuredClone(e));
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
    async prune(keep) {
      prunes.push([...keep]);
      const gone = [...rows.keys()].filter((d) => !keep.includes(d) && !packages.has(d) && !extra.get(d)?.rerunOf);
      if (gone.length > 3) return { deleted: 0, skipped: gone.length };
      for (const d of gone) rows.delete(d);
      return { deleted: gone.length };
    },
  };
  return {
    convex, rows, extra, packages, runs, upserts, fetches, draftCalls, sources, prunes,
    setAwaiting: (n: number) => void (awaitingExtra = n),
    lastSource: (s: SourceReport["source"]) => sources.filter((x) => x.source === s).at(-1),
  };
}
