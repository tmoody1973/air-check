import { episodeStatus, formatTracklist } from "@aircheck/core";
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { sameToken } from "./agentSubmit";
import { attemptsSince, awaitingReviewCount, correctionFor, draftRunsFor, episodeByDate, episodeRows, factsOf, isOpenRun, isShowDate, linkedPackage, rescanPending, writeSource } from "./episodes";
import { fixSourceV, scannedEpisodeFields, sourceStateV } from "./schema";
import { MAX_NOTES, queueDraft } from "./tracklist";

// The ingest service on the VM (it reads Box, Google Drive and Dropbox Paper) is the only caller. Every function checks
// INGEST_TOKEN first, in constant time, and fails closed when it is unset or shorter than 32 characters. A token equal
// to another service's or the agent's would let one act as the other, so that refuses everything too (M7).
// Hard Rule 1: nothing here reaches a package. requestDraft only queues the Tracklist page's draft-package run: the agent
// drafts, Tarik approves. Hard Rule 2: the episode shape has no field for a credential or a URL.
function requireIngest(token: string): void {
  const { INGEST_TOKEN, MEDIA_TOKEN, PUBLISHER_TOKEN, RELAY_TOKEN, AGENT_SUBMIT_TOKEN, DEMO_AGENT_SUBMIT_TOKEN } = process.env;
  const shared = [MEDIA_TOKEN, PUBLISHER_TOKEN, RELAY_TOKEN, AGENT_SUBMIT_TOKEN, DEMO_AGENT_SUBMIT_TOKEN].includes(INGEST_TOKEN);
  if (shared || !sameToken(token, INGEST_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

const MAX_NOTES_BYTES = 65_536;
const MAX_TRACKS = 100;
const MAX_QUESTIONS = 20;
const MAX_QUESTION_CHARS = 1_000;
const MAX_ERROR_CHARS = 200;
const PACE = 3;
/** I3: more than this many rows to remove in one pass looks like a bad read, not renamed docs: remove none. */
const MAX_PRUNE = 3;
/** The scanner reports at most this many undated names per scan. */
const MAX_UNPLACED = 50;

const scannedEpisodeV = v.object(scannedEpisodeFields);
type ScannedEpisode = Infer<typeof scannedEpisodeV>;

/** Why a scanned episode is refused, in plain words, or null. */
function scanProblem(e: ScannedEpisode): string | null {
  if (!isShowDate(e.showDate)) return "showDate must be a real date, yyyy-mm-dd";
  if (e.notes.text !== undefined && new TextEncoder().encode(e.notes.text).length > MAX_NOTES_BYTES) return "the notes text is over 64 KB";
  if ((e.tracklist.text?.length ?? 0) > MAX_NOTES) return "the tracklist text is over 20,000 characters";
  if ((e.tracklist.tracks?.length ?? 0) > MAX_TRACKS) return `the tracklist has over ${MAX_TRACKS} tracks`;
  if (e.questions.length > MAX_QUESTIONS) return `over ${MAX_QUESTIONS} questions`;
  if (e.questions.some((q) => q.text.length > MAX_QUESTION_CHARS)) return `a question is over ${MAX_QUESTION_CHARS} characters`;
  if (new Set(e.questions.map((q) => q.id)).size !== e.questions.length) return "question ids must be unique";
  return null;
}

/**
 * One scanned show. The scan's facts replace the last scan's; answers carry over while their question is unchanged
 * (same id and text), and the rerun mark, the No to "is this a rerun?" and the fetch state stay. A marked or declined
 * week never gets a rerun question again (R7).
 */
export const upsert = mutation({
  args: { token: v.string(), episode: scannedEpisodeV },
  handler: async (ctx, { token, episode }) => {
    requireIngest(token);
    const problem = scanProblem(episode);
    if (problem) throw new ConvexError({ code: "BAD_INPUT", message: problem });
    const cur = await episodeByDate(ctx, episode.showDate);
    const questions = episode.questions
      .filter((q) => q.kind !== "rerun" || !(cur?.rerunOf || cur?.rerunDeclined))
      .map((q) => {
        const old = cur?.questions.find((o) => o.id === q.id && o.text === q.text);
        return old?.answer ? { ...q, answer: old.answer, ...(old.answeredAt !== undefined && { answeredAt: old.answeredAt }) } : q;
      });
    const scanned = { ...episode, questions, scannedAt: Date.now() };
    if (cur) await ctx.db.patch(cur._id, { ...scanned, audioOnDisk: episode.audioOnDisk, correctionStale: episode.correctionStale, appliedCorrectionAt: episode.appliedCorrectionAt });
    else await ctx.db.insert("episodes", scanned);
  },
});

/**
 * Every episode with its package (R1), status, gaps and finished draft runs, and how many packages are ahead of Tarik.
 * Plan 6b: plus Tarik's corrections and placements, and `rescanAfter` (the newest save or undo; 0 for none), which
 * starts a rescan when it is newer than the last scan.
 */
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireIngest(token);
    const corrections = (await ctx.db.query("corrections").collect()).map(({ _id, _creationTime, ...c }) => {
      void _id, _creationTime;
      return c;
    });
    const placed = await ctx.db.query("placements").collect();
    const undoneAt = (await ctx.db.query("rescanAsks").first())?.at ?? 0;
    const rescanAfter = Math.max(0, undoneAt, ...corrections.map((c) => c.updatedAt), ...placed.map((p) => p.updatedAt));
    return {
      episodes: await episodeRows(ctx), awaitingReview: await awaitingReviewCount(ctx),
      corrections, placements: placed.map(({ source, id, date }) => ({ source, id, date })), rescanAfter,
    };
  },
});

/** Plan 6b: after each complete scan, the names it could not date, replaced whole. Names only, never file contents. */
export const reportUnplaced = mutation({
  args: { token: v.string(), items: v.array(v.object({ source: fixSourceV, id: v.string(), name: v.string(), reason: v.string() })) },
  handler: async (ctx, { token, items }) => {
    requireIngest(token);
    if (items.length > MAX_UNPLACED) throw new ConvexError({ code: "BAD_INPUT", message: `over ${MAX_UNPLACED} undated names` });
    for (const u of await ctx.db.query("unplaced").collect()) await ctx.db.delete(u._id);
    const seenAt = Date.now();
    // One row per source and id, so place's lookup is unique.
    const byKey = new Map(items.map((i) => [`${i.source}\u0000${i.id}`, i]));
    for (const { source, id, name, reason } of byKey.values())
      await ctx.db.insert("unplaced", { source, id, name: name.slice(0, MAX_QUESTION_CHARS), reason: reason.slice(0, MAX_QUESTION_CHARS), seenAt });
  },
});

/**
 * I3: after a scan that read every connected source, rows for dates no source has any more (a renamed or deleted doc)
 * go. A row with a package, a rerun mark, an ahead-of-time mark (scannedAt 0) or a correction is a person's record and
 * stays.
 */
export const prune = mutation({
  args: { token: v.string(), keep: v.array(v.string()) },
  handler: async (ctx, { token, keep }) => {
    requireIngest(token);
    const kept = new Set(keep);
    const gone = [];
    for (const e of await ctx.db.query("episodes").collect()) {
      if (kept.has(e.showDate) || e.rerunOf || e.scannedAt === 0 || (await correctionFor(ctx, e.showDate))) continue;
      if ((await linkedPackage(ctx, e.showDate)).packageStatus !== "none") continue;
      gone.push(e._id);
    }
    if (gone.length > MAX_PRUNE) return { deleted: 0, skipped: gone.length };
    for (const id of gone) await ctx.db.delete(id);
    return { deleted: gone.length };
  },
});

/** Where the audio download for a show stands. The error is a short code (Hard Rule 8), never a URL or file name. */
export const setFetch = mutation({
  args: { token: v.string(), showDate: v.string(), status: v.union(v.literal("fetching"), v.literal("fetched"), v.literal("failed")), error: v.optional(v.string()) },
  handler: async (ctx, { token, showDate, status, error }) => {
    requireIngest(token);
    const row = await episodeByDate(ctx, showDate);
    if (!row) throw new ConvexError({ code: "NOT_FOUND" });
    await ctx.db.patch(row._id, { fetch: { status, at: Date.now(), ...(error ? { error: error.slice(0, MAX_ERROR_CHARS) } : {}) } });
  },
});

/**
 * The draft's notes: the Paper text, then Tarik's answers (R4). Both land in the instruction's untrusted-notes section.
 * M3: held to the Tracklist page's cap; the Paper text is cut first so the answers survive.
 */
function draftNotes(e: Doc<"episodes">): string {
  const answered = e.questions.filter((q) => q.answer);
  const answers = answered.length ? ["Tarik's answers", ...answered.map((q) => `Q: ${q.text}\nA: ${q.answer}`)].join("\n") : "";
  const room = Math.max(0, MAX_NOTES - (answers ? answers.length + 2 : 0));
  return [(e.notes.text ?? "").slice(0, room), answers].filter(Boolean).join("\n\n").slice(0, MAX_NOTES);
}

/**
 * Asks for the show's draft: the same draft-package run the Tracklist page queues. Idempotent per show date (Review
 * Focus 4). Whether a show may be drafted is decided here from the stored facts, never by the caller: a package in any
 * status, a rerun, an open question, unclear or missing audio, or a missing tracklist means no run; so do an open draft
 * run for the date, a fix not yet applied by a scan (R4, "rescan-pending"), two finished ones that made no package since
 * the show's latest fix (Review Focus 3), or 3 packages already ahead of Tarik.
 */
export const requestDraft = mutation({
  args: { token: v.string(), showDate: v.string() },
  handler: async (ctx, { token, showDate }) => {
    requireIngest(token);
    if (!isShowDate(showDate)) throw new ConvexError({ code: "BAD_INPUT", message: "showDate must be a real date, yyyy-mm-dd" });
    const row = await episodeByDate(ctx, showDate);
    if (!row) throw new ConvexError({ code: "NOT_FOUND" });
    const runs = await draftRunsFor(ctx, showDate);
    if (runs.some((r) => isOpenRun(r))) {
      // An open run means "drafting" whatever else the facts say, so a second scan never queues a second run.
      const { status } = episodeStatus(factsOf(row, (await linkedPackage(ctx, showDate)).packageStatus));
      return { queued: false, reason: status === "ready-to-draft" ? "drafting" : status } as const;
    }
    if (await rescanPending(ctx, row)) return { queued: false, reason: "rescan-pending" } as const;
    const { status } = episodeStatus(factsOf(row, (await linkedPackage(ctx, showDate)).packageStatus, await attemptsSince(ctx, showDate)));
    if (status !== "ready-to-draft") return { queued: false, reason: status } as const;
    if ((await awaitingReviewCount(ctx)) >= PACE) return { queued: false, reason: "pace" } as const;
    const tracks = row.tracklist.tracks ?? [];
    if (!tracks.length) return { queued: false, reason: "missing-tracklist" } as const;
    const runId = await queueDraft(ctx, "real", { showDate, tracklistText: formatTracklist(tracks), notes: draftNotes(row) });
    return { queued: true, runId } as const;
  },
});

/** What the ingest service found reading a source's credentials (Settings and Episodes). Never the credential itself. */
export const sourceStatus = mutation({
  args: {
    token: v.string(), source: v.union(v.literal("box"), v.literal("google"), v.literal("dropbox")), state: sourceStateV,
    account: v.optional(v.string()), lastError: v.optional(v.string()),
  },
  handler: async (ctx, { token, source, state, account, lastError }) => {
    requireIngest(token);
    const status = { source, state, checkedAt: Date.now(), ...(account ? { account } : {}), ...(lastError ? { lastError: lastError.slice(0, MAX_ERROR_CHARS) } : {}) };
    await writeSource(ctx, status);
  },
});
