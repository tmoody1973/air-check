import {
  type ActiveEmbargo,
  chicagoDayKey,
  checkResearchText,
  deepDiveMarkdown,
  embargoedSearch,
  embargoMatches,
  isShowDate,
  type JudgedClaim,
  judgeClaim,
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
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { sessionKeyOf } from "./demoLimits";
import { enqueueLiveRun } from "./enqueue";
import { episodeByDate, isOpenRun, requireRealHuman } from "./episodes";
import { actorOf, type Workspace, workspaceOf } from "./gate";
import { MAX_NOTES_BYTES } from "./ingest";
import { activeEmbargoes } from "./radar";
import { createdAtOf } from "./runDefaults";
import { stopRun } from "./runs";
import { claimKindV, workspaceV } from "./schema";
import { MAX_TRACKLIST } from "./tracklist";

// Plan 7: sourced research jobs. A job is a Hermes run (kind `research`) whose prompt is built here, in code. The agent
// saves blocks through POST /agent/research -> submitEntry, which writes research rows in its token's workspace and
// nothing else (Hard Rule 1). Closing tracks are never researched (Hard Rule 4). Embargoes are read from Plan 8's
// activeEmbargoes() on every read, never stored. Logs: none.

type Job = Doc<"research">;
type Entry = Doc<"researchEntries">;
type Block = Entry["block"];
type Slot = { key: string; block: Block; closing: boolean };

const ACTIVE: readonly Job["status"][] = ["queued", "running"];
const FINISHED: readonly Job["status"][] = ["done", "stopped", "taken-over"];
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

/** The caller's own job; another workspace's is NOT_FOUND, so nothing leaks. */
async function ownJob(ctx: QueryCtx, jobId: string): Promise<Job> {
  const ws = await callerWorkspace(ctx);
  const job = await jobById(ctx, jobId);
  if (!job || job.workspace !== ws) throw new ConvexError({ code: "NOT_FOUND" });
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
 * One active job per workspace, kind and show date (and subject, for a deep dive; and visitor, in the demo). A job
 * counts as active only while its newest run is open, so a run the relay never reported cannot block the show for good:
 * a new start supersedes it (marked stopped).
 */
async function supersede(ctx: MutationCtx, workspace: Workspace, spec: JobSpec, sessionKey: string | undefined): Promise<void> {
  const same = await ctx.db.query("research").withIndex("by_workspace_kind_showDate", (q) => q.eq("workspace", workspace).eq("kind", spec.kind).eq("showDate", spec.showDate)).collect();
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
const finishedNotesJob = async (ctx: QueryCtx, workspace: Workspace, showDate: string) =>
  (await notesJobs(ctx, workspace, showDate)).find((j) => FINISHED.includes(j.status));

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

/** P10: the plain helper ingest (Task 5) and the query share. The newest finished show-notes job, rendered by core. */
export async function draftNotesFromResearch(ctx: QueryCtx, workspace: Workspace, showDate: string): Promise<string> {
  const job = await finishedNotesJob(ctx, workspace, showDate);
  if (!job) return "";
  return renderNotesForDraft(notesView(job, await liveEntries(ctx, job.jobId), await activeEmbargoes(ctx, workspace, chicagoDayKey(Date.now()))));
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

/** The notes to check, snapshotted now. Air Check's own come as the agent copy (D3: no PRIVATE marker lines). */
async function notesText(ctx: QueryCtx, ws: Workspace, showDate: string, notes: Infer<typeof notesFromV>): Promise<string> {
  if (notes.from === "pasted") return notes.text;
  if (notes.from === "paper") {
    await requireRealHuman(ctx);
    const text = (await episodeByDate(ctx, showDate))?.notes.text;
    if (!text) throw refuse(`No Paper notes for ${showDate}.`);
    return text;
  }
  const job = await finishedNotesJob(ctx, ws, showDate);
  if (!job) throw refuse(`No finished Air Check show notes for ${showDate} yet.`);
  const view = notesView(job, await liveEntries(ctx, job.jobId), await activeEmbargoes(ctx, ws, chicagoDayKey(Date.now())));
  return showNotesMarkdown(view, { forAgent: true });
}

export const startVerify = mutation({
  args: { showDate: v.string(), notes: notesFromV, tracklistText: v.optional(v.string()) },
  handler: async (ctx, { showDate, notes, tracklistText }) => {
    const ws = await callerWorkspace(ctx);
    requireShowDate(showDate);
    const text = await notesText(ctx, ws, showDate, notes);
    if (!text.trim()) throw refuse("The notes are empty.");
    if (new TextEncoder().encode(text).length > MAX_NOTES_BYTES) throw refuse("The notes are over 64 KB. Check them in parts.");
    const tracks = await showTracks(ctx, ws, showDate, tracklistText);
    if (!tracks) throw refuse("Add the tracklist first, so closing tracks are skipped.");
    return startJob(ctx, ws, { kind: "verify", showDate, tracks, lines: numberLines(text, tracks), notesSource: notes.from, angles: false });
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

async function requeue(ctx: MutationCtx, job: Job, keys: string[], scope?: string[]): Promise<{ runId: string }> {
  const runId = await queueRun(ctx, job, keys);
  if (!runId) throw refuse(PAUSED, "PAUSED");
  await ctx.db.patch(job._id, { status: "queued", runIds: [...job.runIds, runId], continuations: 0, scope, finishedAt: undefined, updatedAt: Date.now() });
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

/** One block again. A block Tarik edited is overwritten only when he says so; then his edit is cleared. No continuation. */
export const regenerate = mutation({
  args: { jobId: v.string(), key: v.string(), overwriteEdit: v.boolean() },
  handler: async (ctx, { jobId, key, overwriteEdit }) => {
    const job = await ownJob(ctx, jobId);
    refuseActive(job, "Wait for this job to finish, or take over first.");
    slotFor(job, key);
    const entry = await entryAt(ctx, jobId, key);
    if (entry?.edited && !overwriteEdit) throw refuse("This block has your edits. Regenerate anyway?", "HAS_EDITS");
    const out = await requeue(ctx, job, [key], [key]);
    if (entry?.edited) await ctx.db.patch(entry._id, { edited: undefined, updatedAt: Date.now() });
    return out;
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
    for (const e of await liveEntries(ctx, jobId)) {
      if (e.block !== "track") continue;
      const was = old.get(e.key);
      const now = was && nextById.get(id(was));
      if (!now || now.closing) await ctx.db.patch(e._id, { stale: true, updatedAt });
      else if (now.key !== e.key) await ctx.db.patch(e._id, { key: now.key, updatedAt });
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
    // ponytail: a straight-line estimate from the job's pace so far; good enough for "about N minutes".
    const secondsLeft = running && done > 0 && done < todo.length ? Math.round(((Date.now() - job.createdAt) / done) * (todo.length - done) / 1000) : undefined;
    const { _id, _creationTime, sessionKey, ...fields } = job;
    return {
      job: fields,
      tracks: (job.tracks ?? []).map((t) => {
        const embargo = trackEmbargo(t, active);
        return embargo ? { ...t, embargo } : t;
      }),
      ...(job.subject && { subjectEmbargo: subjectEmbargo(job.subject.name, active) }),
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
    // ponytail: past-show counts come from play history (Task 5); until then the brief says "No past shows found".
    return deepDiveMarkdown({
      subject: { type: job.subject!.type, name: job.subject!.name }, embargo: subjectEmbargo(job.subject!.name, active),
      tracks: job.tracks ?? [], ...(brief && { entry: forView(brief) }), pastShows: { count: 0, year: Number(day.slice(0, 4)) },
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

/** Web searches used today in the caller's workspace, and the cap. */
export const searchUsage = query({
  args: { today: v.optional(v.string()) },
  handler: async (ctx, { today }) => {
    const ws = workspaceOf(await actorOf(ctx));
    return ws ? { used: await webUsed(ctx, ws, dayOf(today)), cap: SEARCH_CAP[ws] } : null;
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
    if (list.length > LIMITS.claimsPerBlock) problems.push(`At most ${LIMITS.claimsPerBlock} ${field} in one block.`);
    list.forEach((c, i) => {
      check(c.text, "claim", `${label} ${i + 1}`);
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
  if (claims.length - connects.length > LIMITS.deepDiveFactsMax) problems.push(`A brief has at most ${LIMITS.deepDiveFactsMax} facts.`);
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
 * Tarik edited; the fields pass rule 3; each claim is judged by code against the posted sources, and a claim with no
 * source is dropped and named. The block replaces the agent's earlier version, keeping Tarik's own fields.
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
    if (existing?.edited) return no(409, [`${slot.key} was edited by Tarik; skip it.`]);
    const problems = blockProblems(job, slot, input);
    if (problems.length) return no(400, problems);

    const sources = Object.fromEntries(input.sources.map(({ id, ...s }) => [id, s]));
    const dropped: string[] = [];
    const judged = (list: ClaimIn[] | undefined, label: string) =>
      (list ?? []).flatMap((c, i) => {
        if (c.sources.length) return [judgeClaim(c, sources)];
        dropped.push(`${label} ${i + 1} has no source. No source, no sentence.`);
        return [];
      });
    const claims = [...judged(input.claims, "Claim"), ...judged(input.threads, "Thread")];
    const now = Date.now();
    const agentPrivate = input.private ? { by: "agent" as const, ...(input.private.reason && { reason: input.private.reason }) } : undefined;
    const fields = {
      claims, intro: input.intro, angle: input.angle, note: input.note, replacement: input.replacement,
      private: existing?.private?.by === "tarik" ? existing.private : agentPrivate,
      savedAt: now, updatedAt: now,
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
 * Scheduled by relay.finished (and by a stop that cancels a queued run) for a research run. With keys left, a block
 * saved in this run, no Take over and continuations under MAX_CONTINUATIONS, it queues one more run for the keys left
 * (a demo one only if it can run live, D11c). Otherwise the job ends done (all keys), stopped (cancelled, taken over,
 * a Regenerate's one block, or out of continuations) or failed (nothing saved). Only the job's newest run counts.
 */
export const onRunFinished = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const run = await runById(ctx, runId);
    const job = run?.jobId ? await jobById(ctx, run.jobId) : null;
    if (!run || !job || job.runIds.at(-1) !== runId || ![...ACTIVE, "taken-over"].includes(job.status)) return;
    const now = Date.now();
    const end = (status: Job["status"], lastProblems?: string[]) =>
      ctx.db.patch(job._id, { status, finishedAt: now, updatedAt: now, ...(lastProblems && { lastProblems }) });
    const entries = await liveEntries(ctx, job.jobId);
    const left = remainingKeys(job, entries);
    if (!left.length) return end("done");
    if (job.status === "taken-over" || run.status === "cancelled") return end("stopped");
    if (!entries.some((e) => (e.savedAt ?? -1) >= createdAtOf(run))) return end("failed");
    if (job.scope || job.continuations >= MAX_CONTINUATIONS) return end("stopped");
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
