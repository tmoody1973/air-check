import { episodeStatus, formatTracklist, isShowDate } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { attemptsSince, awaitingReviewCount, draftRunsFor, episodeByDate, factsOf, inScope, isOpenRun, linkedPackage, rescanPending, requireRealHuman } from "./episodes";
import { draftNotesFromResearch } from "./research";
import { MAX_NOTES, queueDraft } from "./tracklist";

/** At most this many packages wait for Tarik before the ingest service drafts another (Draft now skips it: he asked). */
export const PACE = 3;

/**
 * The draft's notes: the Paper text, then Tarik's answers (R4). Both land in the instruction's untrusted-notes section.
 * Plan 7 Task 5 (design spec 5.7): with no Paper notes, Air Check's newest done show notes for the date stand in, as
 * notesForDraft renders them (sourced facts only; nothing private, edited or embargoed; R9).
 * M3: held to the Tracklist page's cap; the notes are cut first so the answers survive.
 */
async function draftNotes(ctx: QueryCtx, e: Doc<"episodes">): Promise<string> {
  const answered = e.questions.filter((q) => q.answer);
  const answers = answered.length ? ["Tarik's answers", ...answered.map((q) => `Q: ${q.text}\nA: ${q.answer}`)].join("\n") : "";
  const room = Math.max(0, MAX_NOTES - (answers ? answers.length + 2 : 0));
  const notes = e.notes.text?.trim() ? e.notes.text : await draftNotesFromResearch(ctx, "real", e.showDate);
  return [notes.slice(0, room), answers].filter(Boolean).join("\n\n").slice(0, MAX_NOTES);
}

export type DraftOutcome = { queued: true; runId: string } | { queued: false; reason: string };

/**
 * Queues the show's draft: the same draft-package run the Tracklist page queues, from the stored tracklist and notes.
 * Whether a show may be drafted is decided here from the stored facts, never by the caller: a package in any status,
 * a rerun, an open question, unclear or missing audio, or a missing tracklist means no run; so do an open draft run for
 * the date (idempotent per date), a date out of the backlog, a fix not yet applied by a scan (R4), a fix gone stale
 * (R5), and two finished drafts that made no package since the latest fix (Review Focus 3). `pace`: the ingest
 * service also waits while 3 packages are ahead of Tarik; his own Draft now does not.
 */
export async function draftIfReady(ctx: MutationCtx, showDate: string, { pace }: { pace: boolean }): Promise<DraftOutcome> {
  const row = await episodeByDate(ctx, showDate);
  if (!row) throw new ConvexError({ code: "NOT_FOUND" });
  // A 2025 date Tarik removed can keep its row (a correction, or prune's cap); it is never drafted.
  if (!(await inScope(ctx, showDate))) return { queued: false, reason: "not-in-backlog" };
  const runs = await draftRunsFor(ctx, showDate);
  if (runs.some((r) => isOpenRun(r))) {
    // An open run means "drafting" whatever else the facts say, so a second request never queues a second run.
    const { status } = episodeStatus(factsOf(row, (await linkedPackage(ctx, showDate)).packageStatus));
    return { queued: false, reason: status === "ready-to-draft" ? "drafting" : status };
  }
  if (await rescanPending(ctx, row)) return { queued: false, reason: "rescan-pending" };
  // R5: a stale fix fell back to the doc or folder Tarik rejected; drafting it would freeze the wrong facts.
  if (row.correctionStale) return { queued: false, reason: "fix-stale" };
  const { status } = episodeStatus(factsOf(row, (await linkedPackage(ctx, showDate)).packageStatus, await attemptsSince(ctx, showDate)));
  if (status !== "ready-to-draft") return { queued: false, reason: status };
  if (pace && (await awaitingReviewCount(ctx)) >= PACE) return { queued: false, reason: "pace" };
  const tracks = row.tracklist.tracks ?? [];
  if (!tracks.length) return { queued: false, reason: "missing-tracklist" };
  const runId = await queueDraft(ctx, "real", { showDate, tracklistText: formatTracklist(tracks), notes: await draftNotes(ctx, row) });
  return { queued: true, runId };
}

const WHY: Record<string, string> = {
  drafting: "This show is already drafting. Open Watch it work on its row.",
  "rescan-pending": "A fix for this show is waiting for the next scan, about a minute. Try again then.",
  "fix-stale": "This show's fix no longer applies. Fix it again on its row first.",
  "not-in-backlog": "This show isn't in the backlog.",
  "missing-tracklist": "This show has no tracklist yet.",
};

/**
 * Oct 30 (Tarik): Draft now, from the Episodes row of a show waiting to draft. The same checks and inputs as the ingest
 * service's request, minus the oldest-first order and the pace of 3: he chose this show. A signed-in real human only;
 * it queues the agent's draft, never an approval or a publish (Hard Rule 1).
 */
export const draftNow = mutation({
  args: { showDate: v.string() },
  handler: async (ctx, { showDate }) => {
    await requireRealHuman(ctx);
    if (!isShowDate(showDate)) throw new ConvexError({ code: "BAD_INPUT", message: "showDate must be a real date, yyyy-mm-dd" });
    const r = await draftIfReady(ctx, showDate, { pace: false });
    if (!r.queued) throw new ConvexError({ code: "BAD_INPUT", message: WHY[r.reason] ?? "This show isn't ready to draft yet; its row says what's missing." });
    return { runId: r.runId };
  },
});
