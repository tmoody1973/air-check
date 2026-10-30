import {
  type ActiveEmbargo,
  chicagoDayKey,
  checkResearchText,
  credits,
  deepDiveMarkdown,
  embargoedSearch,
  embargoMatches,
  crateOnlySubject,
  deepDiveQueries,
  firstSearchQuery,
  INFOBOX_FIELDS,
  secondSearchQuery,
  isShowDate,
  type JudgedClaim,
  judgeClaim,
  lastPlayed,
  LIMITS,
  MAX_CONTINUATIONS,
  normalize,
  notesForDraft as renderNotesForDraft,
  numberLines,
  parseTracklist,
  type ResearchEntry,
  researchInput,
  type ResearchTrack,
  researchTracks,
  type ResearchTextWhere,
  type RunState,
  SEARCH_CAP,
  type ShowNotesView,
  showNotesMarkdown,
  stepText,
  type Track,
  trackEmbargo,
  verifyReport,
} from "@aircheck/core";
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { sessionKeyOf } from "./demoLimits";
import { enqueueLiveRun } from "./enqueue";
import { episodeByDate, isOpenRun, requireRealHuman } from "./episodes";
import { actorOf, type Workspace, workspaceOf } from "./gate";
import { activeEmbargoes } from "./radar";
import { createdAtOf } from "./runDefaults";
import { stopRun } from "./runs";
import { claimKindV, workspaceV } from "./schema";
import { SAMPLE_JOB_PREFIX } from "./seedResearch";
import { MAX_NOTES, MAX_NOTES_BYTES, MAX_TRACKLIST } from "./tracklist";

// Plan 7: sourced research jobs. A job is a Hermes run (kind `research`) whose prompt is built here, in code. The agent
// saves blocks through POST /agent/research -> submitEntry, which writes research rows in its token's workspace and
// nothing else (Hard Rule 1). Closing tracks are never researched (Hard Rule 4). Embargoes are read from Plan 8's
// activeEmbargoes() on every read, never stored. Logs: none.

type Job = Doc<"research">;
type Entry = Doc<"researchEntries">;
type Block = Entry["block"];
type Slot = { key: string; block: Block; closing: boolean };

const ACTIVE: readonly Job["status"][] = ["queued", "running"];
/** R6: Apple Music lookups per workspace per Chicago day, apart from the web cap (the bridge sends no job id). */
const APPLE_CAP = { real: 60, demo: 20 } as const;
const MAX_EDIT = 4_000;
const MAX_SUPPLIED = 2_000;
const MAX_NAME = 200;
const PAUSED = "Live research is paused for the demo today. The sample report is below.";
const DEMO_LIMIT = "The demo's live limit for today is reached.";
const closingKey = (key: string) => `${key} is a closing track. Closing tracks are never researched.`;
const closingSlot = (s: Slot) => (s.block === "line" ? `${s.key} is under a closing track. Closing tracks are never researched.` : closingKey(s.key));
const closingOfHour = (hour: number) => `That's the closing track of hour ${hour}. Closing tracks are never researched.`;
const refuse = (message: string, code = "BAD_INPUT") => new ConvexError({ code, message });

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
// ponytail: byte % 36 has a slight bias; fine for an id the agent repeats, not for a secret.
const newJobId = () => `rj-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => BASE36[b % 36]).join("")}`;
const dayOf = (today?: string) => (today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : chicagoDayKey(Date.now()));

// ---- reads shared by the functions below ----

const jobById = (ctx: QueryCtx, jobId: string) => ctx.db.query("research").withIndex("by_jobId", (q) => q.eq("jobId", jobId)).unique();
const runById = (ctx: QueryCtx, runId: string | undefined) =>
  runId ? ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", runId)).unique() : Promise.resolve(null);
const liveEntries = async (ctx: QueryCtx, jobId: string) =>
  (await ctx.db.query("researchEntries").withIndex("by_jobId_key", (q) => q.eq("jobId", jobId)).collect()).filter((e) => !e.stale);
const entryAt = async (ctx: QueryCtx, jobId: string, key: string) =>
  (await ctx.db.query("researchEntries").withIndex("by_jobId_key", (q) => q.eq("jobId", jobId).eq("key", key)).collect()).find((e) => !e.stale);

async function callerWorkspace(ctx: QueryCtx): Promise<Workspace> {
  const ws = workspaceOf(await actorOf(ctx));
  if (!ws) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return ws;
}

const SAMPLE_REFUSAL = "The sample report can't be changed. Start your own from Plan.";

/**
 * The caller's own job, for every write. Another workspace's job, or (R11) another demo visitor's, is NOT_FOUND, so
 * nothing leaks. The seeded sample is shared by every demo visitor, so no one may change it or queue runs on it.
 */
async function ownJob(ctx: MutationCtx, jobId: string): Promise<Job> {
  const ws = await callerWorkspace(ctx);
  const job = await jobById(ctx, jobId);
  if (!job || job.workspace !== ws) throw new ConvexError({ code: "NOT_FOUND" });
  if (job.jobId.startsWith(SAMPLE_JOB_PREFIX)) throw refuse(SAMPLE_REFUSAL, "SAMPLE");
  if (ws === "demo" && job.sessionKey !== (await sessionKeyOf(ctx))) throw new ConvexError({ code: "NOT_FOUND" });
  return job;
}

/** Every block a job issues a key for. Closing tracks and their note lines are listed so they can be refused by name. */
function slotsOf(job: Pick<Job, "kind" | "tracks" | "lines">): Slot[] {
  if (job.kind === "deep-dive") return [{ key: "brief", block: "brief", closing: false }];
  if (job.kind === "verify") return (job.lines ?? []).map((l) => ({ key: l.id, block: "line", closing: l.closing }));
  const tracks = job.tracks ?? [];
  return ([1, 2] as const)
    .filter((h) => tracks.some((t) => t.hour === h))
    .flatMap((h): Slot[] => [
      { key: `H${h}.intro`, block: "intro", closing: false },
      { key: `H${h}.threads`, block: "threads", closing: false },
      ...tracks.filter((t) => t.hour === h).map((t): Slot => ({ key: t.key, block: "track", closing: t.closing })),
    ]);
}

/** Oct 29: the names a long source must mention near a value (core sourceSays): the block's track, or the deep dive's subject. */
function namesFor(job: Pick<Job, "kind" | "subject" | "tracks" | "lines">, key: string): string[] {
  if (job.kind === "deep-dive") return job.subject ? [job.subject.name] : [];
  const trackKey = job.kind === "verify" ? job.lines?.find((l) => l.id === key)?.trackKey : key;
  const track = job.tracks?.find((t) => t.key === trackKey);
  return track ? [track.artist, track.title] : [];
}

/** Saved by the agent, or edited by Tarik: either way not researched again by a Resume or a continuation. */
const isDone = (e: Entry | undefined) => !!e && (e.savedAt !== undefined || e.edited !== undefined);
function remainingKeys(job: Job, entries: Entry[]): string[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return slotsOf(job).filter((s) => !s.closing && !isDone(byKey.get(s.key))).map((s) => s.key);
}

function slotFor(job: Job, key: string): Slot {
  const slot = slotsOf(job).find((s) => s.key === key);
  if (!slot) throw refuse(`${key.slice(0, 40)} is not part of this job.`);
  if (slot.closing) throw refuse(closingSlot(slot));
  return slot;
}

// ---- search usage ----

const usageRow = async (ctx: QueryCtx, workspace: Workspace, day: string, source?: "apple_music") =>
  (await ctx.db.query("searchUsage").withIndex("by_workspace_day", (q) => q.eq("workspace", workspace).eq("day", day)).collect()).find((r) => r.source === source);
const webUsed = async (ctx: QueryCtx, workspace: Workspace, day: string) => (await usageRow(ctx, workspace, day))?.count ?? 0;

// ---- queueing runs ----

type JobSpec = Pick<Job, "kind" | "showDate" | "subject" | "tracks" | "lines" | "notesSource" | "angles">;
const titleOf = (j: JobSpec) =>
  j.kind === "show-notes" ? `Show notes · ${j.showDate}` : j.kind === "verify" ? `Pre-air check · ${j.showDate}` : `Deep dive · ${j.subject?.name}`;

/** The run instruction, built in code (core researchInput). Searches left are read now, never copied (P4). */
async function promptFor(ctx: QueryCtx, workspace: Workspace, jobId: string, j: JobSpec, keys?: string[]): Promise<string> {
  const now = Date.now();
  return researchInput({
    jobId, kind: j.kind, showDate: j.showDate, tracks: j.tracks, lines: j.lines, keys, angles: j.angles,
    ...(j.subject && { subject: { type: j.subject.type, name: j.subject.name } }),
    searchesLeft: Math.max(0, SEARCH_CAP[workspace] - (await webUsed(ctx, workspace, chicagoDayKey(now)))),
    embargoes: await activeEmbargoes(ctx, workspace, chicagoDayKey(now)),
  });
}

/** A live research run, or null where the demo would script it. `sessionKey`: the demo visitor's (D11b). */
async function queueRun(ctx: MutationCtx, job: Job, keys: string[], sessionKey?: string): Promise<string | null> {
  const input = await promptFor(ctx, job.workspace, job.jobId, job, keys);
  return enqueueLiveRun(ctx, { workspace: job.workspace, kind: "research", title: titleOf(job), input, jobId: job.jobId }, sessionKey);
}

const busy = (j: JobSpec) =>
  j.kind === "show-notes" ? `Show notes for ${j.showDate} are already being written.`
  : j.kind === "verify" ? `The notes for ${j.showDate} are already being checked.`
  : `A deep dive on ${j.subject?.name} is already being written.`;

/**
 * One active job per workspace, kind and show date (per subject instead, for a deep dive; and per visitor, in the demo). A job
 * counts as active only while its newest run is open, so a run the relay never reported cannot block the show for good:
 * a new start supersedes it (marked stopped).
 */
async function supersede(ctx: MutationCtx, workspace: Workspace, spec: JobSpec, sessionKey: string | undefined): Promise<void> {
  // M7: a deep dive is one per subject whatever the show date, so it reads the whole kind.
  const same = await ctx.db.query("research").withIndex("by_workspace_kind_showDate", (q) =>
    spec.kind === "deep-dive" ? q.eq("workspace", workspace).eq("kind", spec.kind) : q.eq("workspace", workspace).eq("kind", spec.kind).eq("showDate", spec.showDate)).collect();
  const now = Date.now();
  for (const j of same) {
    if (!ACTIVE.includes(j.status)) continue;
    if (spec.kind === "deep-dive" && normalize(j.subject?.name ?? "") !== normalize(spec.subject?.name ?? "")) continue;
    if (workspace === "demo" && j.sessionKey !== sessionKey) continue;
    const run = await runById(ctx, j.runIds.at(-1));
    if (run && isOpenRun(run)) throw refuse(busy(spec));
    await ctx.db.patch(j._id, { status: "stopped", updatedAt: now, finishedAt: now });
  }
}

async function startJob(ctx: MutationCtx, workspace: Workspace, spec: JobSpec): Promise<{ jobId: string; runId: string }> {
  const sessionKey = workspace === "demo" ? await sessionKeyOf(ctx) : undefined;
  await supersede(ctx, workspace, spec, sessionKey);
  const jobId = newJobId();
  const input = await promptFor(ctx, workspace, jobId, spec);
  const runId = await enqueueLiveRun(ctx, { workspace, kind: "research", title: titleOf(spec), input, jobId }, sessionKey);
  if (!runId) throw refuse(PAUSED, "PAUSED");
  const now = Date.now();
  await ctx.db.insert("research", { workspace, jobId, ...spec, status: "queued", runIds: [runId], continuations: 0, sessionKey, createdAt: now, updatedAt: now });
  return { jobId, runId };
}

// ---- tracks ----

function checkHours(tracks: Pick<Track, "hour">[]): void {
  for (const h of [1, 2]) if (!tracks.some((t) => t.hour === h)) throw refuse(`Hour ${h} has no tracks.`);
}

/** Parsed as the Tracklist page does; refused on an unreadable line or an empty hour. */
function parsedTracks(text: string): ResearchTrack[] {
  if (text.length > MAX_TRACKLIST) throw refuse("The tracklist is too long.");
  const { tracks, bad } = parseTracklist(text);
  if (bad.length) throw refuse(`The tracklist has a line Air Check cannot read (line ${bad[0]!.line}). Fix it first.`);
  checkHours(tracks);
  return researchTracks(tracks);
}

/** The real episode's tracklist. Hard Rule 9: the demo never reads Tarik's episodes. */
async function episodeTracks(ctx: QueryCtx, workspace: Workspace, showDate: string): Promise<ResearchTrack[] | undefined> {
  if (workspace !== "real") return undefined;
  const tracks = (await episodeByDate(ctx, showDate))?.tracklist.tracks;
  return tracks?.length ? researchTracks(tracks) : undefined;
}

const notesJobs = async (ctx: QueryCtx, workspace: Workspace, showDate: string) =>
  (await ctx.db.query("research").withIndex("by_workspace_kind_showDate", (q) => q.eq("workspace", workspace).eq("kind", "show-notes").eq("showDate", showDate)).collect())
    .sort((a, b) => b.createdAt - a.createdAt);
/** R9: the newest done show-notes job; a stopped or taken-over one never feeds a draft or a verify. */
const doneNotesJob = async (ctx: QueryCtx, workspace: Workspace, showDate: string) =>
  (await notesJobs(ctx, workspace, showDate)).find((j) => j.status === "done");

/** P11: the newest show-notes job's tracks, else the real episode's, else the typed tracklist. */
async function showTracks(ctx: QueryCtx, workspace: Workspace, showDate: string, text?: string): Promise<ResearchTrack[] | undefined> {
  const fromJob = (await notesJobs(ctx, workspace, showDate))[0]?.tracks;
  if (fromJob?.length) return fromJob;
  return (await episodeTracks(ctx, workspace, showDate)) ?? (text?.trim() ? parsedTracks(text) : undefined);
}

const requireShowDate = (showDate: string) => {
  if (!isShowDate(showDate)) throw refuse("The show date must be a real date, yyyy-mm-dd.");
};

// ---- views ----

const forView = (e: Entry): ResearchEntry => ({
  key: e.key, claims: e.claims as JudgedClaim[],
  ...(e.intro !== undefined && { intro: e.intro }), ...(e.angle !== undefined && { angle: e.angle }), ...(e.note !== undefined && { note: e.note }),
  ...(e.replacement !== undefined && { replacement: e.replacement }), ...(e.private && { private: e.private }),
  ...(e.suppliedNote !== undefined && { suppliedNote: e.suppliedNote }), ...(e.edited && { edited: { text: e.edited.text } }),
});
const notesView = (job: Job, entries: Entry[], embargoes: ActiveEmbargo[]): ShowNotesView => ({
  showDate: job.showDate ?? "", angles: job.angles, tracks: job.tracks ?? [], entries: entries.map(forView), embargoes,
});
/** D2: a deep-dive subject is embargoed when Plan 8's matcher finds its name in prose. */
const subjectEmbargo = (name: string, active: ActiveEmbargo[]) => {
  const hit = embargoMatches({ description: name }, active).blocking[0];
  return hit ? { until: hit.embargo.until } : undefined;
};

function verifyMarkdown(job: Job, entries: Entry[], active: ActiveEmbargo[]): string {
  const held = new Set((job.tracks ?? []).filter((t) => trackEmbargo(t, active)).map((t) => t.key));
  const lineOf = new Map((job.lines ?? []).map((l) => [l.id, l]));
  const mark = (id: string) => (held.has(lineOf.get(id)?.trackKey ?? "") ? " · PRIVATE" : "");
  const { changes, open } = verifyReport({ lines: job.lines ?? [], entries: entries.map(forView), tracks: job.tracks });
  return [
    `# Pre-air check ${job.showDate}`,
    "## Changes",
    changes.length ? changes.map((c) => `- **${c.lineId}** ${c.replacement}${mark(c.lineId)}`).join("\n") : "No changes.",
    "## Still open",
    open.length ? open.map((o) => `- ${o}${mark(o.split(":")[0]!)}`).join("\n") : "Nothing open.",
  ].join("\n\n") + "\n";
}

/**
 * R9/I3: a deep dive on an artist, from Tarik's real episodes: the shows in the year (of the job's show date, else
 * today) before that date whose tracklist credits the artist, and the newest. The export says only a count of 1 or more
 * (R10: a zero cannot be known). Undefined in the demo, which never reads episodes (Hard Rule 9), and for a label or
 * release subject.
 */
async function pastShows(ctx: QueryCtx, job: Job, today: string): Promise<{ count: number; year: number; last?: string } | undefined> {
  if (job.workspace !== "real" || job.subject?.type !== "artist") return undefined;
  const before = job.showDate ?? today;
  const year = before.slice(0, 4);
  const rows = await ctx.db.query("episodes").withIndex("by_showDate", (q) => q.gte("showDate", `${year}-01-01`).lt("showDate", before)).collect();
  // R10: each credited artist (Plan 8's credits(): &, comma, x, and, with, feat.) by whole equality, a leading "The" ignored.
  const bare = (s: string) => s.replace(/^the /, "");
  const name = bare(normalize(job.subject.name));
  const credit = (t: { artist: string; feat?: string }) => [...credits(t.artist), ...(t.feat ? credits(t.feat) : [])].some((c) => bare(c) === name);
  const played = rows.filter((r) => (r.tracklist.tracks ?? []).some(credit));
  return { count: played.length, year: Number(year), ...(played.length && { last: played.at(-1)!.showDate }) };
}

/**
 * P10: the plain helper ingest (Task 5) and the query share. The newest done show-notes job, rendered by core, held to
 * the draft form's notes cap (D14).
 */
export async function draftNotesFromResearch(ctx: QueryCtx, workspace: Workspace, showDate: string): Promise<string> {
  const job = await doneNotesJob(ctx, workspace, showDate);
  if (!job) return "";
  return renderNotesForDraft(notesView(job, await liveEntries(ctx, job.jobId), await activeEmbargoes(ctx, workspace, chicagoDayKey(Date.now())))).slice(0, MAX_NOTES);
}

/**
 * Task 5: real verify jobs created since `since`, each `ready` once done, as counts only (changes offered, claims still
 * open), for the Telegram line that links to the report. Never a line, claim or source. Listed by creation, not by
 * finish, so a done job sent back to queued (Regenerate, Resume) stays listed and its line is never sent twice.
 */
export async function recentVerifyJobs(ctx: QueryCtx, since: number): Promise<{ jobId: string; showDate: string; ready: boolean; changes: number; open: number }[]> {
  const jobs = await ctx.db.query("research").withIndex("by_workspace_created", (q) => q.eq("workspace", "real").gte("createdAt", since)).collect();
  return Promise.all(jobs.filter((j) => j.kind === "verify").map(async (j) => {
    const { changes, open } = verifyReport({ lines: j.lines ?? [], entries: (await liveEntries(ctx, j.jobId)).map(forView), tracks: j.tracks });
    return { jobId: j.jobId, showDate: j.showDate ?? "", ready: j.status === "done", changes: changes.length, open: open.length };
  }));
}

// ---- public: start ----

export const startShowNotes = mutation({
  args: { showDate: v.string(), tracklistText: v.optional(v.string()), angles: v.boolean() },
  handler: async (ctx, { showDate, tracklistText, angles }) => {
    const ws = await callerWorkspace(ctx);
    requireShowDate(showDate);
    let tracks: ResearchTrack[];
    if (tracklistText?.trim()) tracks = parsedTracks(tracklistText);
    else {
      const found = await episodeTracks(ctx, ws, showDate);
      if (!found) throw refuse(ws === "demo" ? "Paste the tracklist first." : `No tracklist for ${showDate} yet. Paste one.`);
      checkHours(found);
      tracks = found;
    }
    return startJob(ctx, ws, { kind: "show-notes", showDate, tracks, angles });
  },
});

const notesFromV = v.union(v.object({ from: v.literal("air-check") }), v.object({ from: v.literal("paper") }), v.object({ from: v.literal("pasted"), text: v.string() }));

type NotesText = { text: string; tracks?: ResearchTrack[] };
/** The real episode's Paper notes. Callers decide who may read them (Hard Rule 9: never the demo). */
const paperText = async (ctx: QueryCtx, showDate: string) => (await episodeByDate(ctx, showDate))?.notes.text || undefined;

/** The notes to check, snapshotted now. Air Check's own come as the agent copy (D3: no PRIVATE marker lines). */
async function notesText(ctx: QueryCtx, ws: Workspace, showDate: string, notes: Infer<typeof notesFromV>): Promise<NotesText> {
  if (notes.from === "pasted") return { text: notes.text };
  if (notes.from === "paper") {
    await requireRealHuman(ctx);
    const text = await paperText(ctx, showDate);
    if (!text) throw refuse(`No Paper notes for ${showDate}.`);
    return { text };
  }
  const job = await doneNotesJob(ctx, ws, showDate);
  if (!job) throw refuse(`No finished Air Check show notes for ${showDate} yet.`);
  const view = notesView(job, await liveEntries(ctx, job.jobId), await activeEmbargoes(ctx, ws, chicagoDayKey(Date.now())));
  // M5: the notes are numbered against the tracks they were written for.
  return { text: showNotesMarkdown(view, { forAgent: true }), tracks: job.tracks };
}

type NotesFrom = Infer<typeof notesFromV>["from"];
async function beginVerify(ctx: MutationCtx, ws: Workspace, showDate: string, from: NotesFrom, { text, tracks: ownTracks }: NotesText, tracklistText?: string) {
  if (!text.trim()) throw refuse("The notes are empty.");
  if (new TextEncoder().encode(text).length > MAX_NOTES_BYTES) throw refuse("The notes are over 64 KB. Check them in parts.");
  const tracks = ownTracks ?? (await showTracks(ctx, ws, showDate, tracklistText));
  if (!tracks) throw refuse("Add the tracklist first, so closing tracks are skipped.");
  return startJob(ctx, ws, { kind: "verify", showDate, tracks, lines: numberLines(text, tracks), notesSource: from, angles: false });
}

export const startVerify = mutation({
  args: { showDate: v.string(), notes: notesFromV, tracklistText: v.optional(v.string()) },
  handler: async (ctx, { showDate, notes, tracklistText }) => {
    const ws = await callerWorkspace(ctx);
    requireShowDate(showDate);
    return beginVerify(ctx, ws, showDate, notes.from, await notesText(ctx, ws, showDate, notes), tracklistText);
  },
});

export const startDeepDive = mutation({
  args: { type: v.union(v.literal("artist"), v.literal("label"), v.literal("release")), name: v.string(), showDate: v.optional(v.string()), fromKey: v.optional(v.string()) },
  handler: async (ctx, { type, name: raw, showDate, fromKey }) => {
    const ws = await callerWorkspace(ctx);
    const name = raw.trim();
    if (!name || name.length > MAX_NAME) throw refuse(`Name the ${type} in at most ${MAX_NAME} characters.`);
    if (showDate !== undefined) requireShowDate(showDate);
    const tracks = (showDate && (await showTracks(ctx, ws, showDate))) || [];
    if (fromKey !== undefined) {
      const from = tracks.find((t) => t.key === fromKey);
      if (!from) throw refuse(`No track ${fromKey.slice(0, 40)} in that show.`);
      if (from.closing) throw refuse(closingOfHour(from.hour));
    }
    // Hard Rule 4: never a closing track, even when asked for by name.
    const n = normalize(name);
    const closing = tracks.find((t) => t.closing && (normalize(t.artist) === n || normalize(t.title) === n));
    if (closing) throw refuse(closingOfHour(closing.hour));
    return startJob(ctx, ws, { kind: "deep-dive", showDate, subject: { type, name, ...(fromKey !== undefined && { fromKey }) }, tracks, angles: false });
  },
});

// ---- public: steer ----

/** R1: stop now, keep what is saved. taken-over first, so the agent's next submit is refused; then the run is stopped. */
export const takeOver = mutation({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const job = await ownJob(ctx, jobId);
    if (!ACTIVE.includes(job.status)) return;
    await ctx.db.patch(job._id, { status: "taken-over", updatedAt: Date.now() });
    const run = await runById(ctx, job.runIds.at(-1));
    if (run) await stopRun(ctx, run);
  },
});

async function requeue(ctx: MutationCtx, job: Job, keys: string[], scope?: string[], overwriteKeys?: string[]): Promise<{ runId: string }> {
  // R12: a demo Resume or Regenerate counts against the visitor who owns the job (ownJob checked it is the caller).
  const runId = await queueRun(ctx, job, keys, job.sessionKey);
  if (!runId) throw refuse(PAUSED, "PAUSED");
  await ctx.db.patch(job._id, { status: "queued", runIds: [...job.runIds, runId], continuations: 0, scope, overwriteKeys, finishedAt: undefined, updatedAt: Date.now() });
  return { runId };
}

const refuseActive = (job: Job, message: string) => {
  if (ACTIVE.includes(job.status)) throw refuse(message);
};

/** Researches the keys with no saved block; Tarik's edited blocks are skipped. */
export const resume = mutation({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const job = await ownJob(ctx, jobId);
    refuseActive(job, "This job is already running.");
    const keys = remainingKeys(job, await liveEntries(ctx, jobId));
    if (!keys.length) throw refuse("Nothing left to research.");
    return requeue(ctx, job, keys);
  },
});

/**
 * One block again (job.scope = [key]: no continuation). A block Tarik edited is regenerated only when he says so, and
 * his edit is cleared only when the new block is saved (submitEntry), so a stopped Regenerate keeps it (M4). Only an edit
 * that existed when he confirmed may be replaced (job.overwriteKeys); one he makes during the run is kept (setOwn).
 */
export const regenerate = mutation({
  args: { jobId: v.string(), key: v.string(), overwriteEdit: v.boolean() },
  handler: async (ctx, { jobId, key, overwriteEdit }) => {
    const job = await ownJob(ctx, jobId);
    refuseActive(job, "Wait for this job to finish, or take over first.");
    slotFor(job, key);
    const edited = !!(await entryAt(ctx, jobId, key))?.edited;
    if (edited && !overwriteEdit) throw refuse("This block has your edits. Regenerate anyway?", "HAS_EDITS");
    return requeue(ctx, job, [key], [key], edited ? [key] : undefined);
  },
});

/** Tarik's own fields on a block, kept by every agent save. A block he touches first gets a row with no claims. */
async function setOwn(ctx: MutationCtx, jobId: string, key: string, fields: Partial<Pick<Entry, "edited" | "private" | "suppliedNote">>, onlyTracks = false): Promise<void> {
  const job = await ownJob(ctx, jobId);
  const slot = slotFor(job, key);
  if (onlyTracks && slot.block !== "track") throw refuse("Supplied notes go on a track.");
  const entry = await entryAt(ctx, jobId, key);
  const updatedAt = Date.now();
  if (entry) await ctx.db.patch(entry._id, { ...fields, updatedAt });
  else await ctx.db.insert("researchEntries", { workspace: job.workspace, jobId, key, block: slot.block, claims: [], ...fields, updatedAt });
  // A new edit is newer than any Regenerate confirmation: the agent's save may no longer replace it (I2).
  if (fields.edited && job.overwriteKeys?.includes(key)) await ctx.db.patch(job._id, { overwriteKeys: job.overwriteKeys.filter((k) => k !== key) });
}

/** Tarik's text replaces the block in every view; empty text removes his edit. */
export const editEntry = mutation({
  args: { jobId: v.string(), key: v.string(), text: v.string() },
  handler: async (ctx, { jobId, key, text }) => {
    if (text.length > MAX_EDIT) throw refuse(`An edit is at most ${MAX_EDIT} characters.`);
    await setOwn(ctx, jobId, key, { edited: text.trim() ? { text, at: Date.now() } : undefined });
  },
});

export const setPrivate = mutation({
  args: { jobId: v.string(), key: v.string(), private: v.boolean() },
  handler: async (ctx, { jobId, key, private: mark }) => {
    await setOwn(ctx, jobId, key, { private: mark ? { by: "tarik" } : undefined });
  },
});

/** Shown as "from your supplied notes, which I did not independently check"; never blended with sourced facts. */
export const setSuppliedNote = mutation({
  args: { jobId: v.string(), key: v.string(), note: v.string() },
  handler: async (ctx, { jobId, key, note }) => {
    if (note.length > MAX_SUPPLIED) throw refuse(`A supplied note is at most ${MAX_SUPPLIED.toLocaleString("en-US")} characters.`);
    await setOwn(ctx, jobId, key, { suppliedNote: note.trim() ? note : undefined }, true);
  },
});

/**
 * A new tracklist for show notes: entries follow their track (normalized artist and title) to its new key. A track that
 * left the list, or became a closing track, has its entry marked stale (kept, never shown). New tracks wait for Resume.
 */
export const retarget = mutation({
  args: { jobId: v.string(), tracklistText: v.string() },
  handler: async (ctx, { jobId, tracklistText }) => {
    const job = await ownJob(ctx, jobId);
    if (job.kind !== "show-notes") throw refuse("Only show notes follow a new tracklist.");
    refuseActive(job, "Take over first, then change the tracklist.");
    const next = parsedTracks(tracklistText);
    const id = (t: ResearchTrack) => `${normalize(t.artist)}|${normalize(t.title)}`;
    const old = new Map((job.tracks ?? []).map((t) => [t.key, t]));
    const nextById = new Map(next.map((t) => [id(t), t]));
    const updatedAt = Date.now();
    const taken = new Set<string>(); // M3: duplicate tracks never put two live entries on one key
    for (const e of await liveEntries(ctx, jobId)) {
      if (e.block !== "track") continue;
      const was = old.get(e.key);
      const now = was && nextById.get(id(was));
      if (!now || now.closing || taken.has(now.key)) await ctx.db.patch(e._id, { stale: true, updatedAt });
      else {
        taken.add(now.key);
        if (now.key !== e.key) await ctx.db.patch(e._id, { key: now.key, updatedAt });
      }
    }
    await ctx.db.patch(job._id, { tracks: next, updatedAt });
  },
});

// ---- public: read ----

/**
 * One job for the research page: entries (stale ones left out), tracks with today's embargo marks, progress counts and
 * time left (computed here, Hard Rule 10), and the active run's latest step (P5). `today` is the browser's Chicago day:
 * a subscription does not re-run when the day changes (D1).
 */
export const get = query({
  args: { jobId: v.string(), today: v.optional(v.string()) },
  handler: async (ctx, { jobId, today }) => {
    const ws = workspaceOf(await actorOf(ctx));
    const job = ws ? await jobById(ctx, jobId) : null;
    if (!job || job.workspace !== ws) return null;
    const active = await activeEmbargoes(ctx, ws, dayOf(today));
    const entries = await liveEntries(ctx, jobId);
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const slots = slotsOf(job);
    const closing = new Set(slots.filter((s) => s.closing).map((s) => s.key));
    const todo = slots.filter((s) => !s.closing);
    const done = todo.filter((s) => isDone(byKey.get(s.key))).length;
    const run = await runById(ctx, job.runIds.at(-1));
    const steps = (run?.state as RunState | undefined)?.steps ?? [];
    const running = ACTIVE.includes(job.status);
    // ponytail: a straight-line estimate from this run's pace (blocks saved since it was queued); good enough for "about N
    // minutes". A Resume a day later is not paced from the job's creation.
    const runStart = run ? createdAtOf(run) : job.createdAt;
    const doneNow = todo.filter((s) => (byKey.get(s.key)?.savedAt ?? -1) >= runStart).length;
    const secondsLeft = running && doneNow > 0 && done < todo.length ? Math.round(((Date.now() - runStart) / doneNow) * (todo.length - done) / 1000) : undefined;
    const { _id, _creationTime, sessionKey, ...fields } = job;
    return {
      job: fields,
      sample: job.jobId.startsWith(SAMPLE_JOB_PREFIX),
      tracks: (job.tracks ?? []).map((t) => {
        const embargo = trackEmbargo(t, active);
        return embargo ? { ...t, embargo } : t;
      }),
      ...(job.subject && { subjectEmbargo: subjectEmbargo(job.subject.name, active), pastShows: await pastShows(ctx, job, dayOf(today)) }),
      entries: entries.filter((e) => !closing.has(e.key)).map(({ _id: _e, _creationTime: _c, workspace: _w, jobId: _j, ...e }) => e),
      progress: { done, total: todo.length },
      ...(secondsLeft !== undefined && { secondsLeft }),
      ...(running && run ? { activeRunId: run.runId } : {}),
      ...(running && steps.length ? { lastStep: stepText(steps.at(-1)!) } : {}),
    };
  },
});

/** The newest 30 jobs in the caller's workspace. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return [];
    const jobs = await ctx.db.query("research").withIndex("by_workspace_created", (q) => q.eq("workspace", ws)).order("desc").take(30);
    return jobs.map((j) => ({ jobId: j.jobId, kind: j.kind, showDate: j.showDate, subject: j.subject, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt }));
  },
});

/** "Copy for Paper": the private Markdown, embargoed blocks marked PRIVATE. Nothing is written to Paper. */
export const exportMarkdown = query({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const ws = workspaceOf(await actorOf(ctx));
    const job = ws ? await jobById(ctx, jobId) : null;
    if (!job || job.workspace !== ws) return null;
    const day = chicagoDayKey(Date.now());
    const active = await activeEmbargoes(ctx, ws, day);
    const entries = await liveEntries(ctx, jobId);
    if (job.kind === "show-notes") return showNotesMarkdown(notesView(job, entries, active));
    if (job.kind === "verify") return verifyMarkdown(job, entries, active);
    const brief = entries.find((e) => e.key === "brief");
    const past = await pastShows(ctx, job, day);
    return deepDiveMarkdown({
      subject: { type: job.subject!.type, name: job.subject!.name }, embargo: subjectEmbargo(job.subject!.name, active),
      tracks: job.tracks ?? [], ...(brief && { entry: forView(brief) }), ...(past && { pastShows: past }),
    });
  },
});

/** The draft's NOTES from Air Check's show notes: sourced facts only, no private, edited or embargoed block (Hard Rule 12). */
export const notesForDraft = query({
  args: { showDate: v.string() },
  handler: async (ctx, { showDate }) => {
    const ws = workspaceOf(await actorOf(ctx));
    return ws ? draftNotesFromResearch(ctx, ws, showDate) : "";
  },
});

/** Web searches used today in the caller's workspace, the cap, and (once the bridge reports any) Tavily credits spent. */
export const searchUsage = query({
  args: { today: v.optional(v.string()) },
  handler: async (ctx, { today }) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    const row = await usageRow(ctx, ws, dayOf(today));
    return { used: row?.count ?? 0, cap: SEARCH_CAP[ws], ...(row?.credits !== undefined && { credits: row.credits }) };
  },
});

// ---- internal: the agent's route, the search counter, the relay hook ----

const sourceRefV = v.object({ id: v.string(), says: v.optional(v.string()), primary: v.optional(v.boolean()) });
const claimInV = v.object({ kind: claimKindV, text: v.string(), value: v.optional(v.string()), sources: v.array(sourceRefV) });
const submitV = v.object({
  job: v.string(), key: v.string(),
  claims: v.optional(v.array(claimInV)), intro: v.optional(v.string()), threads: v.optional(v.array(claimInV)),
  angle: v.optional(v.string()), note: v.optional(v.string()), replacement: v.optional(v.string()),
  private: v.optional(v.object({ reason: v.optional(v.string()) })),
  sources: v.array(v.object({ id: v.string(), url: v.string(), host: v.string(), title: v.string(), via: v.string(), text: v.string() })),
});
type Submit = Infer<typeof submitV>;
type ClaimIn = Infer<typeof claimInV>;

/** Preflight T3: which fields each kind of key takes. Any other field is refused by name. */
const FIELDS: Record<Block, readonly string[]> = {
  track: ["claims", "angle", "note", "private"], intro: ["intro"], threads: ["threads"], line: ["claims", "replacement"], brief: ["claims", "note"],
};
const BLOCK_FIELDS = ["claims", "intro", "threads", "angle", "note", "replacement", "private"] as const;

/** Rule 3: field pairing, limits, and checkResearchText on every model-written string. Sentences name only the agent's own words. */
function blockProblems(job: Job, slot: Slot, input: Submit): string[] {
  const wrong = BLOCK_FIELDS.filter((f) => input[f] !== undefined && !FIELDS[slot.block].includes(f));
  if (wrong.length) return wrong.map((f) => `${slot.key} does not take ${f}.`);
  const problems: string[] = [];
  const check = (text: string | undefined, where: ResearchTextWhere, label: string) => {
    const p = text === undefined ? null : checkResearchText(text, where);
    if (p) problems.push(`${label}: ${p}`);
  };
  if (input.angle !== undefined && !job.angles) problems.push("Angles are off for this show; leave angle out.");
  const given = new Set(input.sources.map((s) => s.id));
  const unknown = new Set<string>();
  for (const [field, label] of [["claims", "Claim"], ["threads", "Thread"]] as const) {
    const list = input[field] ?? [];
    if (slot.block === "brief") {
      if (list.length > LIMITS.briefClaims) problems.push(`At most ${LIMITS.briefClaims} claims in the brief.`);
    } else if (list.length > LIMITS.claimsPerBlock) problems.push(`At most ${LIMITS.claimsPerBlock} ${field} in one block.`);
    if (slot.block !== "brief" && list.some((c) => c.kind === "infobox")) problems.push("Only a deep dive's brief takes infobox rows.");
    list.forEach((c, i) => {
      check(c.text, "claim", `${label} ${i + 1}`);
      // I1: value and says are model text too; they reach the export and the claim's check text.
      check(c.value, "claim", `${label} ${i + 1} value`);
      c.sources.forEach((s, j) => check(s.says, "claim", `${label} ${i + 1} source ${j + 1} says`));
      if (c.sources.length > LIMITS.sourcesPerClaim) problems.push(`${label} ${i + 1} cites more than ${LIMITS.sourcesPerClaim} sources.`);
      for (const s of c.sources) if (!given.has(s.id)) unknown.add(s.id);
    });
  }
  for (const id of unknown) problems.push(`${id} is not a source Air Check gave you; cite only [S…] ids from your search results.`);
  check(input.intro, "intro", "intro");
  check(input.angle, "angle", "angle");
  check(input.note, "note", "note");
  check(input.replacement, "replacement", "replacement");
  check(input.private?.reason, "note", "private reason");
  if (slot.block === "brief") problems.push(...briefProblems(job, input.claims ?? []));
  return problems;
}

function briefProblems(job: Job, claims: ClaimIn[]): string[] {
  const problems: string[] = [];
  const connects = claims.filter((c) => c.kind === "connection");
  const infobox = claims.filter((c) => c.kind === "infobox");
  // Decision 023: the brief is an article. Section facts (any other kind, old briefs' included), infobox rows, connections.
  if (claims.length - connects.length - infobox.length > LIMITS.briefFactsMax) problems.push(`A brief has at most ${LIMITS.briefFactsMax} section facts.`);
  if (infobox.length > LIMITS.infoboxMax) problems.push(`A brief has at most ${LIMITS.infoboxMax} infobox rows.`);
  for (const c of infobox) {
    if (!(INFOBOX_FIELDS as readonly string[]).includes(c.text)) problems.push(`An infobox row's text is one of: ${INFOBOX_FIELDS.join(", ")}.`);
    if (!c.value?.trim()) problems.push("An infobox row needs a value.");
  }
  if (connects.length > LIMITS.connectsMax) problems.push(`A brief has at most ${LIMITS.connectsMax} connections.`);
  for (const c of connects) {
    const t = (job.tracks ?? []).find((x) => x.key === c.value);
    if (t?.closing) problems.push(closingKey(t.key));
    else if (!t) problems.push("A connection's value must be a track key from your list.");
  }
  return [...new Set(problems)];
}

type SubmitResult =
  | { ok: true; saved: string; claims: number; verify: number; dropped: string[] }
  | { ok: false; status: 400 | 404 | 409; problems: string[] };

/**
 * The agent's one write (POST /agent/research). Rules in order: the job is the token's workspace's and running (a
 * queued job moves to running on its first save); the key is one the job issued, not a closing track and not a block
 * Tarik edited; the fields pass rule 3; each claim is judged by code against the posted sources (a claim with no source
 * is could-not-verify, or in a pre-air check dropped and named). The block replaces the agent's earlier version, keeping
 * Tarik's own fields.
 */
export const submitEntry = internalMutation({
  args: { workspace: workspaceV, input: submitV },
  handler: async (ctx, { workspace, input }): Promise<SubmitResult> => {
    const job = await jobById(ctx, input.job);
    if (!job || job.workspace !== workspace) return { ok: false, status: 404, problems: [] };
    const no = async (status: 400 | 409, problems: string[]): Promise<SubmitResult> => {
      await ctx.db.patch(job._id, { lastProblems: problems, updatedAt: Date.now() });
      return { ok: false, status, problems };
    };
    if (job.status === "taken-over") return no(409, ["Tarik took over; stop now."]);
    if (!ACTIVE.includes(job.status)) return no(409, ["This research job is not running."]);
    const slot = slotsOf(job).find((s) => s.key === input.key);
    if (!slot) return no(400, [`${input.key} is not a key in this job.`]);
    if (slot.closing) return no(409, [closingSlot(slot)]);
    const existing = await entryAt(ctx, job.jobId, slot.key);
    // A Regenerate Tarik confirmed over his edit (job.overwriteKeys) may replace it; nothing else may.
    if (existing?.edited && !job.overwriteKeys?.includes(slot.key)) return no(409, [`${slot.key} was edited by Tarik; skip it.`]);
    const problems = blockProblems(job, slot, input);
    if (problems.length) return no(400, problems);

    const sources = Object.fromEntries(input.sources.map(({ id, ...s }) => [id, s]));
    const names = namesFor(job, slot.key);
    const dropped: string[] = [];
    // Decision 021: show notes and deep dives keep a sourceless fact (judged could-not-verify, "No source found.") for
    // Tarik to confirm; a pre-air check exists to source a line, so there it is still dropped and named.
    const judged = (list: ClaimIn[] | undefined, label: string) =>
      (list ?? []).flatMap((c, i) => {
        if (c.sources.length || job.kind !== "verify") return [judgeClaim(c, sources, names)];
        dropped.push(`${label} ${i + 1} has no source. A pre-air check needs one.`);
        return [];
      });
    const claims = [...judged(input.claims, "Claim"), ...judged(input.threads, "Thread")];
    const now = Date.now();
    const agentPrivate = input.private ? { by: "agent" as const, ...(input.private.reason && { reason: input.private.reason }) } : undefined;
    const fields = {
      claims, intro: input.intro, angle: input.angle, note: input.note, replacement: input.replacement,
      private: existing?.private?.by === "tarik" ? existing.private : agentPrivate,
      edited: undefined, savedAt: now, updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("researchEntries", { workspace, jobId: job.jobId, key: slot.key, block: slot.block, ...fields });
    await ctx.db.patch(job._id, { status: "running", updatedAt: now });
    const verify = claims.filter((c) => c.status === "conflict" || c.status === "could-not-verify").length;
    return { ok: true, saved: slot.key, claims: claims.length, verify, dropped };
  },
});

/**
 * Before each source_search (POST /agent/search-usage). R2: a query naming an active embargo is refused and not
 * counted; the answer names nothing (R8). Otherwise one is added to today's count only while under the cap. A Convex
 * mutation is serializable, so parallel calls never pass the cap.
 */
export const countSearch = internalMutation({
  args: { workspace: workspaceV, query: v.string(), source: v.optional(v.literal("apple_music")) },
  handler: async (ctx, { workspace, query: text, source }) => {
    const day = chicagoDayKey(Date.now());
    if (embargoedSearch(text, await activeEmbargoes(ctx, workspace, day))) return { allowed: false, embargoed: true };
    const cap = (source ? APPLE_CAP : SEARCH_CAP)[workspace];
    const row = await usageRow(ctx, workspace, day, source);
    const used = row?.count ?? 0;
    if (used >= cap) return { allowed: false, used, cap };
    if (row) await ctx.db.patch(row._id, { count: used + 1 });
    else await ctx.db.insert("searchUsage", { workspace, day, ...(source && { source }), count: 1 });
    return { allowed: true, used: used + 1, cap };
  },
});

/**
 * Oct 29 prefetch (POST /agent/research-prefetch): the tracks of a running show-notes job whose first web search the
 * bridge runs in code, each with its queries (core firstSearchQuery, and since Oct 30 secondSearchQuery). Only keys still to research (a Regenerate: its one
 * block); never a closing track (Hard Rule 4). An embargoed track is listed by key only, never searched (R2, R8). It
 * reads only: each search is still counted by countSearch before it runs.
 * Oct 30 (decision 023): a deep dive's brief, while still to research, is one entry with core deepDiveQueries' five
 * searches (query, query2, extra); a subject kept off web search (crateOnlySubject, as the prompt says) is key only.
 */
export const prefetchPlan = internalQuery({
  args: { workspace: workspaceV, jobId: v.string() },
  handler: async (ctx, { workspace, jobId }) => {
    const job = await jobById(ctx, jobId);
    if (!job || job.workspace !== workspace) return { ok: false as const, status: 404 as const, error: "" };
    const no = (error: string) => ({ ok: false as const, status: 409 as const, error });
    // The bridge reads "Only show notes" as "this job has none"; keep the sentence's start.
    if (job.kind === "verify") return no("Only show notes and deep dives have first searches; use source_search.");
    if (job.status === "taken-over") return no("Tarik took over; stop now.");
    if (!ACTIVE.includes(job.status)) return no("This research job is not running.");
    const keys = new Set(job.scope ?? remainingKeys(job, await liveEntries(ctx, jobId)));
    const active = await activeEmbargoes(ctx, workspace, chicagoDayKey(Date.now()));
    if (job.kind === "deep-dive") {
      if (!keys.has("brief") || !job.subject) return { ok: true as const, tracks: [], embargoed: [] };
      const q = deepDiveQueries(job.subject);
      if (crateOnlySubject(job.subject.name, active) || q.some((x) => embargoedSearch(x, active))) return { ok: true as const, tracks: [], embargoed: ["brief"] };
      return { ok: true as const, tracks: [{ key: "brief", query: q[0]!, query2: q[1]!, extra: q.slice(2) }], embargoed: [] };
    }
    const tracks: { key: string; query: string; query2: string; extra?: string[] }[] = [];
    const embargoed: string[] = [];
    for (const t of job.tracks ?? []) {
      if (t.closing || !keys.has(t.key)) continue;
      const query = firstSearchQuery(t);
      const query2 = secondSearchQuery(t);
      if (trackEmbargo(t, active) || embargoedSearch(query, active) || embargoedSearch(query2, active)) embargoed.push(t.key);
      else tracks.push({ key: t.key, query, query2 });
    }
    return { ok: true as const, tracks, embargoed };
  },
});

/**
 * Oct 29 prefetch (POST /agent/search-done): after a web search, or a prefetch batch, the bridge gives back the searches
 * that failed (only successful ones count against the cap, never below zero) and adds the Tavily credits they cost.
 */
export const searchDone = internalMutation({
  args: { workspace: workspaceV, refund: v.number(), credits: v.number() },
  handler: async (ctx, { workspace, refund, credits }) => {
    const day = chicagoDayKey(Date.now());
    const row = await usageRow(ctx, workspace, day);
    if (row) await ctx.db.patch(row._id, { count: Math.max(0, row.count - refund), credits: (row.credits ?? 0) + credits });
    else if (credits > 0) await ctx.db.insert("searchUsage", { workspace, day, count: 0, credits });
  },
});

/**
 * Scheduled by relay.finished (and by a stop that cancels a queued run) for a research run. With keys left, a block
 * saved in this run, no Take over and continuations under MAX_CONTINUATIONS, it queues one more run for the keys left
 * (a demo one only if it can run live, D11c). Otherwise the job ends done (all keys), stopped (cancelled, taken over,
 * a Regenerate's one block, out of continuations, or a run that saved nothing after earlier runs did) or failed (nothing saved). Only the job's newest run counts.
 */
export const onRunFinished = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }): Promise<void> => {
    const run = await runById(ctx, runId);
    const job = run?.jobId ? await jobById(ctx, run.jobId) : null;
    if (!run || !job || job.runIds.at(-1) !== runId || ![...ACTIVE, "taken-over"].includes(job.status)) return;
    const now = Date.now();
    const end = (status: Job["status"], lastProblems?: string[]) =>
      ctx.db.patch(job._id, { status, finishedAt: now, updatedAt: now, ...(lastProblems && { lastProblems }) });
    const entries = await liveEntries(ctx, job.jobId);
    const left = remainingKeys(job, entries);
    if (!left.length) {
      // P6: a finished real pre-air check gets 88Nine and HYFIN context, looked up in code after it is saved. Once only:
      // a Regenerate or Resume that ends done again keeps the context it has.
      if (job.kind === "verify" && job.workspace === "real" && !job.playContext) await ctx.scheduler.runAfter(0, internal.research.playContext, { jobId: job.jobId });
      return end("done");
    }
    if (job.status === "taken-over" || run.status === "cancelled") return end("stopped");
    if (!entries.some((e) => (e.savedAt ?? -1) >= createdAtOf(run))) {
      // Oct 30: a follow-up that saved nothing after earlier runs did is not a failed job; the saved blocks stand.
      return entries.some((e) => e.savedAt !== undefined) ? end("stopped", ["The last run saved nothing; Resume to finish."]) : end("failed");
    }
    if (job.scope) return end("stopped");
    if (job.continuations >= MAX_CONTINUATIONS) return end("stopped", [`Stopped after ${MAX_CONTINUATIONS} continuations; Resume to finish.`]);
    let next: string | null = null;
    try {
      next = await queueRun(ctx, job, left, job.sessionKey);
    } catch (e) {
      if (!(e instanceof ConvexError && (e.data as { code?: string }).code === "RATE_LIMITED")) throw e;
    }
    if (!next) return end("stopped", [DEMO_LIMIT]);
    await ctx.db.patch(job._id, { status: "queued", runIds: [...job.runIds, next], continuations: job.continuations + 1, updatedAt: now });
  },
});

// ---- Task 5: the Thursday and Friday pre-air check, and station play context ----

const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hourCycle: "h23" });
/** The America/Chicago weekday ("Thu") and hour (0-23) of an instant. */
function chicagoClock(ms: number): { weekday: string; hour: number } {
  const p = Object.fromEntries(clock.formatToParts(ms).map((x) => [x.type, x.value]));
  return { weekday: p.weekday ?? "", hour: Number(p.hour) };
}
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const VERIFY_HOUR = 9;

/**
 * Hourly (crons.ts). At 9 am in Chicago on a Thursday or a Friday it checks the notes for the next show (Friday's: the
 * coming one on Thursday, today's on Friday), in the real workspace only, unless a check for that show was already
 * started today (by this or by Tarik). Notes: the newest done Air Check show notes, else the episode's Paper notes, else
 * nothing. A refusal (busy, no tracklist, too long) queues nothing; the answer is a code, never notes text (Hard Rule 8).
 */
export const scheduledVerify = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ queued: boolean; reason?: string }> => {
    const now = Date.now();
    const { weekday, hour } = chicagoClock(now);
    if (hour !== VERIFY_HOUR || (weekday !== "Thu" && weekday !== "Fri")) return { queued: false, reason: "not-now" };
    const today = chicagoDayKey(now);
    const showDate = weekday === "Fri" ? today : nextDay(today);
    const earlier = await ctx.db.query("research").withIndex("by_workspace_kind_showDate", (q) => q.eq("workspace", "real").eq("kind", "verify").eq("showDate", showDate)).collect();
    if (earlier.some((j) => chicagoDayKey(j.createdAt) === today)) return { queued: false, reason: "started-today" };
    const ownNotes = await doneNotesJob(ctx, "real", showDate);
    const paper = ownNotes ? undefined : await paperText(ctx, showDate);
    if (!ownNotes && !paper) return { queued: false, reason: "no-notes" };
    try {
      const got = ownNotes ? await notesText(ctx, "real", showDate, { from: "air-check" }) : { text: paper! };
      await beginVerify(ctx, "real", showDate, ownNotes ? "air-check" : "paper", got);
      return { queued: true };
    } catch (e) {
      if (e instanceof ConvexError) return { queued: false, reason: "refused" };
      throw e;
    }
  },
});

const stationV = v.union(v.literal("88nine"), v.literal("hyfin"));
const STATIONS = ["88nine", "hyfin"] as const;
const playRowV = v.object({ artist: v.string(), station: stationV, lastPlayed: v.optional(v.string()) });

/** The artists a done real verify job asks play history about: each distinct one, never a closing track's (Hard Rule 4). */
export const playArtists = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }): Promise<string[]> => {
    const job = await jobById(ctx, jobId);
    if (!job || job.workspace !== "real" || job.kind !== "verify" || job.status !== "done") return [];
    const byName = new Map<string, string>();
    for (const t of job.tracks ?? []) if (!t.closing && normalize(t.artist) && !byName.has(normalize(t.artist))) byName.set(normalize(t.artist), t.artist);
    return [...byName.values()];
  },
});

/** Convex ends an action at 10 minutes; no new lookup starts after this, so the days found are always saved. */
const PLAY_DEADLINE_MS = 8 * 60_000;

/**
 * P6, scheduled by onRunFinished for a done real verify job. One lookup per distinct artist and station (88nine and
 * hyfin only, Hard Rule 3, checked again in core's lastPlayed), one at a time. The first thrown lookup (the service is
 * down) or the deadline ends the pass, and the days found so far are saved. Only days found are kept: no play in the
 * window says nothing, so no row claims an artist was never played (Hard Rule 10). The demo never gets here (Hard Rule 9).
 */
export const playContext = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }): Promise<void> => {
    const artists: string[] = await ctx.runQuery(internal.research.playArtists, { jobId });
    if (!artists.length) return;
    const stop = Date.now() + PLAY_DEADLINE_MS;
    const found: Infer<typeof playRowV>[] = [];
    pass: for (const artist of artists) {
      for (const station of STATIONS) {
        if (Date.now() >= stop) break pass;
        const day = await lastPlayed(fetch, station, artist).catch(() => undefined);
        if (day === undefined) break pass;
        if (day) found.push({ artist, station, lastPlayed: day });
      }
    }
    await ctx.runMutation(internal.research.savePlayContext, { jobId, playContext: found });
  },
});

export const savePlayContext = internalMutation({
  args: { jobId: v.string(), playContext: v.array(playRowV) },
  handler: async (ctx, { jobId, playContext }): Promise<void> => {
    const job = await jobById(ctx, jobId);
    if (!job || job.workspace !== "real" || job.kind !== "verify") return;
    await ctx.db.patch(job._id, { playContext, updatedAt: Date.now() });
  },
});
