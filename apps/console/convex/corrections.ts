import { formatTracklist, isShowDate, parseDriveTracklist } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { correctionFor, draftRunsFor, episodeByDate, isOpenRun, linkedPackage, requireRealHuman } from "./episodes";
import { actorOf, workspaceOf } from "./gate";
import { fixSourceV } from "./schema";
import { MAX_NOTES } from "./tracklist";

// Plan 6b (decision 017): Tarik fixes a backlog show in the console, and the fix is saved here for the scanner to use
// instead of what Drive, Paper or Box say. Nothing here writes to a source or reaches a package (Hard Rule 1).
// - Only a signed-in real human writes (Hard Rule 9); the agent has no tool or route for these.
// - A picked id must be one the show's current question offered (Review Focus 5).
// - A show with a package, or an open draft run, is frozen: it is changed on the package page.
// - R3: once a show's audio is downloaded, its audio fix can't change, or a draft could use the old files.

type Correction = Doc<"corrections">;
type Episode = Doc<"episodes">;
type Fix = NonNullable<Episode["questions"][number]["fix"]>;

const MAX_TRACKS = 100;
const FROZEN = "this show already has a package; change it on the package page";
const ON_DISK = "this show's audio is already downloaded";
const REASONS = { "no-separator": "needs “Artist - Title”", "before-hour-marker": "add a HOUR 1 or HOUR 2 line above it" } as const;

const badInput = (message: string) => new ConvexError({ code: "BAD_INPUT", message });

async function refuseFrozen(ctx: QueryCtx, showDate: string): Promise<void> {
  if ((await linkedPackage(ctx, showDate)).packageStatus !== "none") throw badInput(FROZEN);
  if ((await draftRunsFor(ctx, showDate)).some((r) => isOpenRun(r))) throw badInput(FROZEN);
}

/** The checks every show correction shares: a real human, a known show, not frozen, and (for audio) not downloaded. */
async function editable(ctx: QueryCtx, showDate: string, audio: boolean): Promise<Episode> {
  await requireRealHuman(ctx);
  const row = await episodeByDate(ctx, showDate);
  if (!row) throw new ConvexError({ code: "NOT_FOUND", message: "no such show" });
  if (row.scannedAt === 0) throw badInput("this show hasn't been found in Box, Drive or Paper yet");
  await refuseFrozen(ctx, showDate);
  if (audio && row.audioOnDisk) throw badInput(ON_DISK);
  return row;
}

/** Writes one field (and updatedAt), keeping the show's other fixes. */
async function save(ctx: MutationCtx, showDate: string, field: Partial<Omit<Correction, "_id" | "_creationTime" | "showDate" | "updatedAt">>): Promise<void> {
  const cur = await correctionFor(ctx, showDate);
  const fields = { ...field, updatedAt: Date.now() };
  if (cur) await ctx.db.patch(cur._id, fields);
  else await ctx.db.insert("corrections", { showDate, ...fields });
}

/** The fixes the show's current questions offer. */
const offers = (row: Episode): Fix[] => row.questions.flatMap((q) => (q.fix ? [q.fix] : []));

/** Undo deletes a placement, which leaves no updatedAt behind, so the scanner is told to rescan here. */
async function askRescan(ctx: MutationCtx): Promise<void> {
  const row = await ctx.db.query("rescanAsks").first();
  if (row) await ctx.db.patch(row._id, { at: Date.now() });
  else await ctx.db.insert("rescanAsks", { at: Date.now() });
}

/** Why a typed tracklist can't be used, in the page's plain words; null when it can. Same rule as the scanner's for Drive. */
function tracklistProblem(text: string): string | null {
  if (text.length > MAX_NOTES) return "The tracklist is over 20,000 characters.";
  const { tracks, bad } = parseDriveTracklist(text);
  if (bad.length) return bad.map((b) => `Line ${b.line} ${REASONS[b.reason]}.`).join(" ");
  for (const h of [1, 2] as const) if (!tracks.some((t) => t.hour === h)) return `The tracklist has no Hour ${h} tracks.`;
  if (tracks.length > MAX_TRACKS) return `The tracklist has ${tracks.length} tracks; a show holds at most ${MAX_TRACKS}.`;
  return null;
}

/** "Fix the tracklist": used exactly as typed, so Paper never changes its spelling. */
export const setTracklist = mutation({
  args: { showDate: v.string(), text: v.string() },
  handler: async (ctx, { showDate, text }) => {
    await editable(ctx, showDate, false);
    const problem = tracklistProblem(text);
    if (problem) throw badInput(problem);
    await save(ctx, showDate, { tracklistText: text });
  },
});

/** "Use this one": which of two Drive docs, Paper docs or Box folders is the show's. */
export const pick = mutation({
  args: { showDate: v.string(), source: fixSourceV, id: v.string() },
  handler: async (ctx, { showDate, source, id }) => {
    const row = await editable(ctx, showDate, source === "box");
    if (!offers(row).some((f) => f.type === "pick" && f.source === source && f.choices.some((c) => c.id === id))) throw badInput("that choice was not offered for this show");
    await save(ctx, showDate, { [source]: id });
  },
});

/** Which Box file is Hour 1 and which is Hour 2: two different files the question offered. */
export const setHours = mutation({
  args: { showDate: v.string(), hour1: v.string(), hour2: v.string() },
  handler: async (ctx, { showDate, hour1, hour2 }) => {
    const row = await editable(ctx, showDate, true);
    if (hour1 === hour2) throw badInput("Hour 1 and Hour 2 must be different files");
    const ok = offers(row).some((f) => f.type === "hours" && [hour1, hour2].every((id) => f.choices.some((c) => c.id === id)));
    if (!ok) throw badInput("those files were not offered for this show");
    await save(ctx, showDate, { hours: { hour1, hour2 } });
  },
});

/** "This show is <folderDate>": the Box folder's date wins over the files' stamp. */
export const useFolderDate = mutation({
  args: { showDate: v.string() },
  handler: async (ctx, { showDate }) => {
    const row = await editable(ctx, showDate, true);
    if (!offers(row).some((f) => f.type === "stamp")) throw badInput("this show has no date question to settle");
    await save(ctx, showDate, { folderDate: true });
  },
});

/**
 * "Remove my fix": removes every fix for the show. Nothing to clear is fine. I2: the row stays as {showDate, updatedAt},
 * so draft runs from before the fix still don't count (attemptsSince) and the new updatedAt starts the rescan.
 */
export const clear = mutation({
  args: { showDate: v.string() },
  handler: async (ctx, { showDate }) => {
    const cur = await correctionFor(ctx, showDate);
    const hasAudio = !!cur && (cur.box !== undefined || cur.hours !== undefined || cur.folderDate !== undefined);
    await editable(ctx, showDate, hasAudio);
    if (cur) await ctx.db.replace(cur._id, { showDate, updatedAt: Date.now() });
  },
});

/**
 * The tracklist editor's starting text: Tarik's fix, else the Drive doc's text, else the stored tracks, else empty.
 * A signed-in real human only, one show at a time; null for anyone else (the Drive text is private).
 */
export const tracklistText = query({
  args: { showDate: v.string() },
  handler: async (ctx, { showDate }) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return null;
    const c = await correctionFor(ctx, showDate);
    if (c?.tracklistText !== undefined) return { text: c.tracklistText, from: "air-check" as const };
    const row = await episodeByDate(ctx, showDate);
    if (row?.tracklist.text) return { text: row.tracklist.text, from: "drive" as const };
    if (row?.tracklist.tracks?.length) return { text: formatTracklist(row.tracklist.tracks), from: "tracks" as const };
    return { text: "", from: "none" as const };
  },
});

const placementBy = (ctx: QueryCtx, source: Doc<"placements">["source"], id: string) =>
  ctx.db.query("placements").withIndex("by_source_id", (q) => q.eq("source", source).eq("id", id)).unique();

const isFriday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5;

/**
 * "This is the show for…": dates a doc or folder whose name the scanner could not read. Never a rename. I1: "Move"
 * re-dates an existing placement even after a scan dropped it from the undated list; a new one needs a listed name.
 */
export const place = mutation({
  args: { source: fixSourceV, id: v.string(), date: v.string() },
  handler: async (ctx, { source, id, date }) => {
    await requireRealHuman(ctx);
    if (!isShowDate(date) || !date.startsWith("2026-")) throw badInput("the date must be a real 2026 date, yyyy-mm-dd");
    if (!isFriday(date)) throw badInput("Rhythm Lab airs Fridays — pick a Friday");
    const cur = await placementBy(ctx, source, id);
    const listed = await ctx.db.query("unplaced").withIndex("by_source_id", (q) => q.eq("source", source).eq("id", id)).unique();
    if (!cur && !listed) throw badInput("that item is not in the list of undated names");
    await refuseFrozen(ctx, date);
    // Moving off a drafted show would change it too, same as Undo.
    if (cur) await refuseFrozen(ctx, cur.date);
    if (cur) await ctx.db.patch(cur._id, { date, updatedAt: Date.now() });
    else await ctx.db.insert("placements", { source, id, date, name: listed!.name, updatedAt: Date.now() });
  },
});

/** Undoes a placement; the name is listed as undated again after the next scan. */
export const unplace = mutation({
  args: { source: fixSourceV, id: v.string() },
  handler: async (ctx, { source, id }) => {
    await requireRealHuman(ctx);
    const cur = await placementBy(ctx, source, id);
    if (!cur) return;
    await refuseFrozen(ctx, cur.date);
    await ctx.db.delete(cur._id);
    await askRescan(ctx);
  },
});
