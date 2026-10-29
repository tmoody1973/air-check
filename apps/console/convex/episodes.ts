import { episodeStatus, isShowDate, type EpisodeFacts, type LinkedPackageStatus } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { actorOf, workspaceOf } from "./gate";
import { createdAtOf } from "./runDefaults";
import { workspaceV } from "./schema";

// Plan 6: the 2026 backlog, one row per show. Hard Rule 9: real workspace only; the demo login and anonymous callers
// read nothing and change nothing. Hard Rule 1: nothing here reaches a package; packages are only read for their status.

type EpisodeDoc = Doc<"episodes">;
type Question = EpisodeDoc["questions"][number];

export { isShowDate };

/** Real package ids are deterministic (core buildPackageDraft): pkg-M-D-YY. */
export const packageIdFor = (showDate: string) => {
  const [y, m, d] = showDate.split("-");
  return `pkg-${Number(m)}-${Number(d)}-${y!.slice(2)}`;
};

export const episodeByDate = (ctx: QueryCtx, showDate: string) =>
  ctx.db.query("episodes").withIndex("by_showDate", (q) => q.eq("showDate", showDate)).unique();

/** The real package for a show date (R1): its status, and its receipt URL once it is on Mixcloud. */
export async function linkedPackage(ctx: QueryCtx, showDate: string): Promise<{ packageStatus: LinkedPackageStatus; receiptUrl?: string }> {
  const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageIdFor(showDate))).unique();
  if (doc?.workspace !== "real") return { packageStatus: "none" };
  return { packageStatus: doc.status as LinkedPackageStatus, ...(doc.status === "succeeded" && doc.result?.url && { receiptUrl: doc.result.url }) };
}

const OPEN = ["queued", "running", "stopping"] as const;
/** R11: a draft run still "open" after this long is stuck; it stops holding the show or the pace (and counts as an attempt). */
export const STUCK_RUN_MS = 6 * 3_600_000;
export const isOpenRun = (r: Doc<"runs">, now = Date.now()) =>
  (OPEN as readonly string[]).includes(r.status ?? "") && now - createdAtOf(r) < STUCK_RUN_MS;

/** The real draft-package runs for one show date: the Tracklist page's and the ingest service's. */
export async function draftRunsFor(ctx: QueryCtx, showDate: string) {
  const runs = await ctx.db.query("runs").withIndex("by_kind_showDate", (q) => q.eq("kind", "draft-package").eq("form.showDate", showDate)).collect();
  return runs.filter((r) => r.workspace === "real");
}

/** Packages ahead of Tarik (the pace of 3): real ones waiting for review or for their MP3, plus real draft runs still open. */
export async function awaitingReviewCount(ctx: QueryCtx): Promise<number> {
  let n = 0;
  for (const status of ["awaiting_review", "preparing_audio"] as const)
    n += (await ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", status)).collect()).length;
  for (const status of OPEN)
    n += (await ctx.db.query("runs").withIndex("by_status", (q) => q.eq("status", status)).collect()).filter((r) => r.workspace === "real" && r.kind === "draft-package" && isOpenRun(r)).length;
  return n;
}

/** What core's episodeStatus, nextToDraft and rerunCandidate read. */
export function factsOf(e: EpisodeDoc, packageStatus: LinkedPackageStatus, draftAttempts = 0): EpisodeFacts {
  return {
    draftAttempts,
    showDate: e.showDate,
    audio: { status: e.audio.status },
    tracklist: { status: e.tracklist.status },
    notes: { status: e.notes.status },
    questions: e.questions,
    packageStatus,
    ...(e.audioOnDisk !== undefined && { audioOnDisk: e.audioOnDisk }),
    ...(e.rerunOf && { rerunOf: e.rerunOf, rerunSource: e.rerunSource }),
    ...(e.rerunDeclined && { rerunDeclined: e.rerunDeclined }),
    ...(e.tracklist.tracks && { tracks: e.tracklist.tracks }),
  };
}

/**
 * Every episode, oldest first, shaped as core's EpisodeFacts plus its package (R1), status and gaps. The tracks sit at
 * the top level for rerun detection. Never the notes text (Hard Rule 12): that is read only to build a draft.
 */
export async function episodeRows(ctx: QueryCtx) {
  const docs = await ctx.db.query("episodes").withIndex("by_showDate").collect();
  return Promise.all(
    docs.map(async (e) => {
      const { _id, _creationTime, notes: { text, ...notes }, tracklist: { tracks, ...tracklist }, ...rest } = e;
      void _id, _creationTime, text;
      const pkg = await linkedPackage(ctx, e.showDate);
      const runs = await draftRunsFor(ctx, e.showDate);
      const draftAttempts = runs.filter((r) => !isOpenRun(r)).length;
      // M2: a draft run is open (R11's 6 h rule), so Episodes says "Drafting" before any package exists.
      const openRun = runs.some((r) => isOpenRun(r));
      return { ...rest, notes, tracklist, ...(tracks && { tracks }), packageId: packageIdFor(e.showDate), ...pkg, draftAttempts, openRun, ...episodeStatus(factsOf(e, pkg.packageStatus, draftAttempts)) };
    }),
  );
}

async function requireRealHuman(ctx: QueryCtx): Promise<void> {
  if (workspaceOf(await actorOf(ctx)) !== "real") throw new ConvexError({ code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can do this" });
}
const badInput = (message: string) => new ConvexError({ code: "BAD_INPUT", message });
const notFound = (message: string) => new ConvexError({ code: "NOT_FOUND", message });

/**
 * Why a rerun mark is refused, in plain words; [] when it is fine. Every path that sets rerunOf (the Episodes row, the
 * answer Yes, the agent's route) checks the original here: an earlier show. A 2026 original must exist and not itself
 * be a rerun; a pre-2026 one has no row (the backlog is 2026 only), so its date is all there is to check (I2).
 */
async function rerunProblems(ctx: QueryCtx, showDate: string, rerunOf: string): Promise<string[]> {
  if (!isShowDate(showDate)) return ["showDate must be a real date, yyyy-mm-dd"];
  if (!isShowDate(rerunOf)) return ["rerunOf must be a real date, yyyy-mm-dd"];
  if (rerunOf >= showDate) return ["rerunOf must be an earlier show than showDate"];
  if (rerunOf < "2026-01-01") return [];
  const original = await episodeByDate(ctx, rerunOf);
  if (!original) return ["no show on that date"];
  return original.rerunOf ? ["that show is itself a rerun"] : [];
}

const withoutRerunQuestions = (qs: Question[]) => qs.filter((q) => q.kind !== "rerun");

/**
 * R7: a marked week is not drafted, fetched or asked "is this a rerun?". The scan keeps the mark. When the scan has not
 * found the show yet (marked ahead of time), a bare row holds the mark until it does.
 */
async function markRerunOf(ctx: MutationCtx, showDate: string, rerunOf: string, rerunSource: "chat" | "episodes") {
  const row = await episodeByDate(ctx, showDate);
  if (row) await ctx.db.patch(row._id, { rerunOf, rerunSource, questions: withoutRerunQuestions(row.questions) });
  else
    await ctx.db.insert("episodes", {
      showDate, audio: { status: "none", flags: [] }, tracklist: { status: "missing" }, notes: { status: "missing" }, questions: [], scannedAt: 0, rerunOf, rerunSource,
    });
}

/** The Episodes page: every 2026 show with its package and status, and how many packages are ahead of Tarik. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return null;
    return { episodes: await episodeRows(ctx), awaitingReview: await awaitingReviewCount(ctx) };
  },
});

/** Settings and Episodes: whether the ingest service can read Box, Google Drive and Dropbox. Never a credential. */
export const sources = query({
  args: {},
  handler: async (ctx) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return null;
    const rows = await ctx.db.query("ingestSources").collect();
    return rows.map(({ source, state, account, lastError, checkedAt }) => ({ source, state, account, lastError, checkedAt })).sort((a, b) => a.source.localeCompare(b.source));
  },
});

type SourceRow = Omit<Doc<"ingestSources">, "_id" | "_creationTime">;

/** The one row per source, replaced whole (so a cleared lastError really clears). Never a credential (Hard Rule 2). */
export async function writeSource(ctx: MutationCtx, status: SourceRow): Promise<void> {
  const row = await ctx.db.query("ingestSources").withIndex("by_source", (q) => q.eq("source", status.source)).unique();
  if (row) await ctx.db.replace(row._id, status);
  else await ctx.db.insert("ingestSources", status);
}

// Connect Google Drive / Connect Dropbox in Settings, after the console wrote or deleted the token file. Box has no
// button (it is a server app), so only these two. A signed-in real human only; the account is a display label.
const buttonSourceV = v.union(v.literal("google"), v.literal("dropbox"));
const MAX_ACCOUNT = 200;

export const sourceConnected = mutation({
  args: { source: buttonSourceV, account: v.string() },
  handler: async (ctx, { source, account }) => {
    await requireRealHuman(ctx);
    if (!account || account.length > MAX_ACCOUNT) throw badInput(`the account label must be 1 to ${MAX_ACCOUNT} characters`);
    await writeSource(ctx, { source, state: "connected", account, checkedAt: Date.now() });
  },
});

export const sourceDisconnected = mutation({
  args: { source: buttonSourceV },
  handler: async (ctx, { source }) => {
    await requireRealHuman(ctx);
    await writeSource(ctx, { source, state: "not_connected", checkedAt: Date.now() });
  },
});

const MAX_ANSWER = 2_000;

/**
 * R4: an answer resolves its question and rides into the draft's untrusted notes. R6/R8: a rerun question takes Yes or
 * No; Yes makes the week a rerun of the candidate (or of the date Tarik names when the candidate is unknown), No means
 * it is never asked again.
 */
export const answer = mutation({
  args: { showDate: v.string(), questionId: v.string(), answer: v.string(), rerunOf: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRealHuman(ctx);
    const row = await episodeByDate(ctx, args.showDate);
    const q = row?.questions.find((x) => x.id === args.questionId);
    if (!row || !q) throw notFound("no such question");
    const text = args.answer.trim();
    if (!text || text.length > MAX_ANSWER) throw badInput(`the answer must be 1 to ${MAX_ANSWER} characters`);
    if (q.kind !== "rerun") {
      await ctx.db.patch(row._id, { questions: row.questions.map((x) => (x.id === q.id ? { ...x, answer: text, answeredAt: Date.now() } : x)) });
      return;
    }
    const questions = withoutRerunQuestions(row.questions);
    if (/^no$/i.test(text)) return void (await ctx.db.patch(row._id, { rerunDeclined: true, questions }));
    if (!/^yes$/i.test(text)) throw badInput("answer Yes or No");
    const of = q.rerunOf || args.rerunOf?.trim() || "";
    if (!of) throw badInput("say which show it is a rerun of");
    const problems = await rerunProblems(ctx, row.showDate, of);
    if (problems.length) throw badInput(problems[0]!);
    await ctx.db.patch(row._id, { rerunOf: of, rerunSource: "detected", questions });
  },
});

/** "Mark as rerun of…" on an Episodes row. */
export const markRerun = mutation({
  args: { showDate: v.string(), rerunOf: v.string() },
  handler: async (ctx, { showDate, rerunOf }) => {
    await requireRealHuman(ctx);
    const problems = await rerunProblems(ctx, showDate, rerunOf);
    if (problems.length) throw badInput(problems[0]!);
    await markRerunOf(ctx, showDate, rerunOf, "episodes");
  },
});

/**
 * Undo on an Episodes row: back to the normal pipeline. A No to the rerun question stays (R9). R12: undoing a mark that
 * came from answering Yes to the scan's question means "not a rerun", so it also declines (never asked again).
 */
export const unmarkRerun = mutation({
  args: { showDate: v.string() },
  handler: async (ctx, { showDate }) => {
    await requireRealHuman(ctx);
    const row = await episodeByDate(ctx, showDate);
    if (!row) throw notFound("no such show");
    // A bare row made by an ahead-of-time mark holds nothing else.
    if (row.scannedAt === 0) await ctx.db.delete(row._id);
    else
      await ctx.db.patch(row._id, { rerunOf: undefined, rerunSource: undefined, ...(row.rerunSource === "detected" && { rerunDeclined: true as const }) });
  },
});

export type AgentMarkResult = { ok: true } | { ok: false; code: "NOT_FOUND" } | { ok: false; code: "BAD_INPUT"; problems: string[] };

/**
 * Internal (the agent's /agent/episodes/rerun, R9): "July 17 is a rerun of March 13" said in Chat. Hard Rule 9: the
 * demo workspace has no episodes, so the demo agent gets NOT_FOUND and writes nothing.
 */
export const agentMarkRerun = internalMutation({
  args: { workspace: workspaceV, showDate: v.string(), rerunOf: v.string() },
  handler: async (ctx, { workspace, showDate, rerunOf }): Promise<AgentMarkResult> => {
    if (workspace !== "real") return { ok: false, code: "NOT_FOUND" };
    const problems = await rerunProblems(ctx, showDate, rerunOf);
    if (problems.length) return { ok: false, code: "BAD_INPUT", problems };
    await markRerunOf(ctx, showDate, rerunOf, "chat");
    return { ok: true };
  },
});
