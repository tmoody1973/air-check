import {
  buildPackageDraft, checkDescriptionChange, formatTracklist, GateError, publishDayOffset, type AgentPackageInput, type GateErrorCode,
  type PackageDraft,
  type PackageRecord, type PackageStatus,
} from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { privateTerms } from "./agentSubmit";
import { isOpen, liveOf, proposeUpdate, updatesOf } from "./descriptionUpdates";
import { actorOf, gateFor, workspaceOf } from "./gate";
import type { MixcloudStatus } from "./mixcloud";
import { toRecord } from "./packageStore";
import { createdAtOf } from "./runDefaults";
import { MAX_TRACKLIST } from "./tracklist";
import { publishQueue } from "./publisher";
import { descriptionEmbargoes, embargoProblems, embargoView } from "./radar";

const asDraft = (d: unknown) => d as PackageDraft;

export type PackageEmbargo = { blocking: { releaseId: Id<"releases">; text: string }[]; sameArtist: string[] };

export const get = query({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }): Promise<(PackageRecord & { embargo: PackageEmbargo }) | null> => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    const doc = await ctx.db
      .query("packages")
      .withIndex("by_packageId", (q) => q.eq("packageId", packageId))
      .unique();
    if (!doc || doc.draft.workspace !== ws) return null;
    const draft = asDraft(doc.draft);
    // Plan 8: what holds this package, in its own workspace (Hard Rule 9). A private view: release ids for Clear embargo.
    return { ...toRecord(doc), embargo: await embargoView(ctx, ws, { description: draft.description, tracks: draft.tracks }) };
  },
});

export const listAwaiting = query({
  args: {},
  handler: async (ctx): Promise<PackageRecord[]> => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return [];
    const docs = await ctx.db
      .query("packages")
      .withIndex("by_workspace_status", (q) => q.eq("workspace", ws).eq("status", "awaiting_review"))
      .collect();
    return docs.map(toRecord);
  },
});

/** A real package for a signed-in real human; null for anyone else, for demo packages and for unknown ids. */
async function realPackage(ctx: QueryCtx, packageId: string) {
  if (workspaceOf(await actorOf(ctx)) !== "real") return null;
  const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
  return doc?.workspace === "real" ? doc : null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type PublishState = { dayOffset: number | null; mixcloudState: MixcloudStatus["state"]; lastError?: string };

/**
 * R2: which Chicago day an approved package should go up (0 = today), from the same queue and count the publisher
 * uses. Like the publisher, a package with no cover (its own or the standard one) is not queued.
 */
export const publishState = query({
  // `today` is the browser's Chicago day key. A subscribed query never re-runs because time passed, so the page
  // passes the day and asks again after midnight. It only shapes this display; the publisher counts its own day.
  args: { packageId: v.string(), today: v.string() },
  handler: async (ctx, { packageId, today }): Promise<PublishState | null> => {
    if (!DAY_KEY.test(today)) throw new ConvexError({ code: "BAD_INPUT", message: "today must be YYYY-MM-DD" });
    if (!(await realPackage(ctx, packageId))) return null;
    const { packages, publishedToday } = await publishQueue(ctx, today);
    // Same mapping as the publisher service's nextToPublish call (apps/publisher/src/publish.ts).
    const approved = packages
      .filter((p) => p.coverStorageId)
      .map((p) => ({ packageId: p.packageId, showDate: p.showDate, approvedAt: p.decidedAt ?? "" }));
    const status = await ctx.db.query("mixcloudStatus").first();
    // I3: a short code only (e.g. cover_unavailable), never a credential (Hard Rule 2 keeps those out of the row).
    return {
      dayOffset: publishDayOffset(approved, publishedToday, packageId, 3), mixcloudState: status?.state ?? "not_connected",
      ...(status?.lastError ? { lastError: status.lastError } : {}),
    };
  },
});

/** R5: the cover the package page shows: the package's own, else the standard cover, else null. */
export const coverPreview = query({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }): Promise<string | null> => {
    const doc = await realPackage(ctx, packageId);
    const id = (doc?.draft as PackageDraft | undefined)?.coverStorageId ?? (doc ? process.env.STANDARD_COVER_STORAGE_ID : undefined);
    if (!id) return null;
    // A mistyped STANDARD_COVER_STORAGE_ID is not a storage id; show no cover rather than break the page.
    return ctx.storage.getUrl(id as Id<"_storage">).catch(() => null);
  },
});

export type DecideResult = { ok: true; record: PackageRecord } | { ok: false; code: GateErrorCode; message: string };
/** Plan 8: Approve is also refused while an embargoed release is in the package. */
export type ApproveResult = DecideResult | { ok: false; code: "EMBARGOED"; message: string };
export type CoverResult = DecideResult | { ok: false; code: "BAD_INPUT"; message: string };

/** The only public mutation that decides a package (Hard Rule 1). */
export const decide = mutation({
  args: { packageId: v.string(), fingerprint: v.string(), decision: v.union(v.literal("approve"), v.literal("skip")) },
  handler: async (ctx, { packageId, fingerprint, decision }): Promise<ApproveResult> => {
    const actor = await actorOf(ctx);
    if (!actor) return { ok: false, code: "FORBIDDEN", message: "Sign in with your Radio Milwaukee account." };
    const doc = await ctx.db
      .query("packages")
      .withIndex("by_packageId", (q) => q.eq("packageId", packageId))
      .unique();
    // Hard Rule 9: a real user never decides a demo package, and the demo login never decides a real one.
    // Same message as the gate's FORBIDDEN so nothing about the package leaks.
    // A demo caller also gets FORBIDDEN for a missing package, so it cannot probe for real package ids.
    if (doc ? doc.workspace !== workspaceOf(actor) : actor.kind === "demo")
      return { ok: false, code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can decide" };
    // Plan 8: an actively embargoed release in the tracks or the description holds Approve (never Skip) until its date
    // or a human's Clear embargo. Checked here, server-side, not only by the page.
    if (decision === "approve" && doc?.status === "awaiting_review") {
      const draft = asDraft(doc.draft);
      const { blocking } = await embargoProblems(ctx, doc.workspace, { description: draft.description, tracks: draft.tracks });
      if (blocking.length) return { ok: false, code: "EMBARGOED", message: `${blocking.join(". ")}. Approve after that date, or clear the embargo.` };
    }
    try {
      const record = await gateFor(ctx).decide(packageId, fingerprint, decision, actor);
      // Already decided differently (A skipped, B taps Approve): the gate returns the current record; tell the user.
      if (record.status !== (decision === "approve" ? "approved" : "skipped"))
        return { ok: false, code: "PACKAGE_CHANGED", message: "This package changed. Open the latest version." };
      return { ok: true, record };
    } catch (e) {
      if (e instanceof GateError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  },
});

/**
 * A signed-in real human picks the cover (or clears it with null) while the package awaits review. The cover goes
 * public, so the package re-fingerprints and must be approved as it now looks.
 */
export const setCover = mutation({
  args: { packageId: v.string(), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { packageId, storageId }): Promise<CoverResult> => {
    const actor = await actorOf(ctx);
    const forbidden = { ok: false, code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can change the cover" } as const;
    if (workspaceOf(actor) !== "real") return forbidden;
    const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
    if (doc && doc.workspace !== "real") return forbidden;
    if (storageId) {
      const file = await ctx.db.system.get(storageId);
      if (!file?.contentType?.startsWith("image/")) return { ok: false, code: "BAD_INPUT", message: "The cover must be an image." };
    }
    try {
      return { ok: true, record: await gateFor(ctx).setCover(packageId, storageId, actor!) };
    } catch (e) {
      if (e instanceof GateError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  },
});

/** A real package for a signed-in real human, or why not. Same FORBIDDEN for a demo package as for a demo caller. */
async function staffOn(ctx: MutationCtx, packageId: string) {
  const actor = await actorOf(ctx);
  if (workspaceOf(actor) !== "real") return null;
  const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
  return doc && doc.workspace !== "real" ? null : actor!;
}

const asResult = async (call: () => Promise<PackageRecord>): Promise<DecideResult> => {
  try {
    return { ok: true, record: await call() };
  } catch (e) {
    if (e instanceof GateError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
};

const STAFF_ONLY = { ok: false, code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can do this" } as const;

/**
 * I2: a failed or uncertain upload goes back to review (awaiting_review), so the host can fix it and approve again.
 * A signed-in real human only; it never makes a package approved (Hard Rule 1).
 */
export const reopen = mutation({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }): Promise<DecideResult> => {
    const actor = await staffOn(ctx, packageId);
    if (!actor || workspaceOf(actor) !== "real") return STAFF_ONLY;
    return asResult(() => gateFor(ctx).reopen(packageId, actor));
  },
});

/** I2: the host checked Mixcloud and an uncertain upload is there: record its address as the receipt. */
export const confirmPosted = mutation({
  args: { packageId: v.string(), url: v.string() },
  handler: async (ctx, { packageId, url }): Promise<DecideResult> => {
    const actor = await staffOn(ctx, packageId);
    if (!actor || workspaceOf(actor) !== "real") return STAFF_ONLY;
    return asResult(() => gateFor(ctx).confirmPosted(packageId, url.trim(), actor));
  },
});

/**
 * Plan 5c: a signed-in real human rewrites the public description while the package awaits review. The sources stay
 * as the agent gave them; the package re-fingerprints, so Approve needs the new text reviewed (Hard Rule 1).
 */
export const editDescription = mutation({
  args: { packageId: v.string(), description: v.string() },
  handler: async (ctx, { packageId, description }): Promise<DecideResult> => {
    const actor = await staffOn(ctx, packageId);
    if (!actor || workspaceOf(actor) !== "real") return STAFF_ONLY;
    const embargoed = await descriptionEmbargoes(ctx, "real", description);
    if (embargoed.length) {
      // Plan 8: added to the description's own problems, so the host sees every reason at once.
      const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
      const problems = [...(doc ? checkDescriptionChange(asDraft(doc.draft), description, undefined, privateTerms()) : []), ...embargoed];
      return { ok: false, code: "BAD_INPUT", message: problems.join("; ") };
    }
    return asResult(() => gateFor(ctx).editDescription(packageId, description, actor, privateTerms()));
  },
});

/**
 * R7: a signed-in real human fixes the tracks while the package awaits review, read like the Tracklist page's text
 * (same parser and length cap); the title's lead artists must still be in it. The Mixcloud sections come from these
 * tracks, so it re-fingerprints and Approve needs them reviewed (Hard Rule 1). The agent has no way to do this (R6).
 */
export const editTracklist = mutation({
  args: { packageId: v.string(), text: v.string() },
  handler: async (ctx, { packageId, text }): Promise<DecideResult> => {
    const actor = await staffOn(ctx, packageId);
    if (!actor || workspaceOf(actor) !== "real") return STAFF_ONLY;
    if (text.length > MAX_TRACKLIST) return { ok: false, code: "BAD_INPUT", message: "the tracklist is over 50,000 characters" };
    return asResult(() => gateFor(ctx).editTracklist(packageId, text, actor));
  },
});

/** A one-time Convex storage upload URL for a cover image. A signed-in real human only. */
export const coverUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") throw new ConvexError({ code: "FORBIDDEN" });
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * R9: the tracklist text of the latest draft-package run (Tracklist page or ingest service) for the show in the
 * workspace, or null when there is none. The package's tracks are always these, parsed in code, never the agent's.
 */
async function requestedTracklist(ctx: QueryCtx, workspace: "real" | "demo", showDate: string): Promise<string | null> {
  const runs = await ctx.db.query("runs").withIndex("by_kind_showDate", (q) => q.eq("kind", "draft-package").eq("form.showDate", showDate)).collect();
  const latest = runs.filter((r) => r.workspace === workspace && r.form).sort((a, b) => createdAtOf(b) - createdAtOf(a))[0];
  return latest ? latest.form!.tracklistText : null;
}

const refuse = (problems: string[]): never => {
  throw new ConvexError({ code: "BAD_INPUT", message: problems.join("; "), problems });
};

/**
 * R9: the agent's draft, built from its picked input with the draft request's tracklist in place of whatever the agent
 * typed (the model flattens curly quotes and accents), so the title's leads, tags and description are checked against
 * the request's tracks. No request for the show in the workspace: refused.
 */
async function agentDraft(ctx: QueryCtx, { input, workspace, idSuffix }: { input: AgentPackageInput; workspace: "real" | "demo"; idSuffix?: string }): Promise<PackageDraft> {
  const text = await requestedTracklist(ctx, workspace, input.showDate);
  if (text === null) return refuse(["no draft request for this show"]);
  const built = buildPackageDraft({ ...input, tracklistText: text }, { privateTerms: privateTerms(), workspace, ...(idSuffix && { idSuffix }) });
  // Plan 8: an embargoed title in the description is one more problem, reported with the rest.
  const embargoed = await descriptionEmbargoes(ctx, workspace, input.description);
  if (!built.ok || embargoed.length) return refuse([...(built.ok ? [] : built.problems), ...embargoed]);
  return built.draft;
}

// Internal: reachable only with the deploy key (Plans 4 and 5). The agent's route sends `agent` and can't change a track
// (R9); a prebuilt `draft` (tests only, no route sends one) is submitted as given.
export const submit = internalMutation({
  args: {
    draft: v.optional(v.any()),
    agent: v.optional(v.object({ input: v.any(), workspace: v.union(v.literal("real"), v.literal("demo")), idSuffix: v.optional(v.string()) })),
  },
  handler: async (ctx, a) => {
    const draft = a.agent ? await agentDraft(ctx, a.agent) : asDraft(a.draft);
    if (!a.agent) {
      const embargoed = await descriptionEmbargoes(ctx, draft.workspace, draft.description);
      if (embargoed.length) refuse(embargoed);
    }
    try {
      return await gateFor(ctx).submit(draft);
    } catch (e) {
      // Only ConvexError data survives the hop to an HTTP action on a deployed backend.
      if (e instanceof GateError) throw new ConvexError({ code: e.code, message: e.message });
      throw e;
    }
  },
});

/** Why the agent cannot revise a package now, in plain words (R3). A published one gets a proposed update instead. */
const NOT_REVISABLE: Record<Exclude<PackageStatus, "awaiting_review" | "succeeded">, string> = {
  preparing_audio: "the MP3 is still being prepared; revise it once the package is waiting for review",
  approved: "already approved; it can no longer change",
  publishing: "being published now; it can no longer change",
  skipped: "skipped by a person; it can no longer change",
  failed: "the upload failed; a person must reopen it for review first",
  outcome_unknown: "the upload outcome is unknown; a person must check Mixcloud first",
};

export type ReviseResult =
  | { ok: true; status: PackageStatus }
  | { ok: true; status: "proposed"; updateId: string }
  | { ok: false; code: "BAD_INPUT"; problems: string[] }
  | { ok: false; code: "NOT_FOUND" | "NOT_READY" | "PACKAGE_CHANGED"; message: string };

/**
 * Internal (the agent's /agent/packages/revise): a new description and sources for a package awaiting review in the
 * token's workspace. Checked like a submit, then the gate's revise with the record's own draft, so hour ids, the MP3,
 * title and tracks are unchanged; it re-fingerprints and stays in review. On a package already on Mixcloud it proposes
 * a description update instead (Task 4), which a signed-in human must approve before the publisher sends it.
 */
export const revise = internalMutation({
  args: { workspace: v.union(v.literal("real"), v.literal("demo")), packageId: v.string(), description: v.string(), descriptionSources: v.optional(v.any()) },
  handler: async (ctx, { workspace, packageId, description, descriptionSources }): Promise<ReviseResult> => {
    const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
    const cur = doc && toRecord(doc);
    // The other workspace's package answers exactly like a missing one, so a token cannot probe for ids.
    if (!cur || cur.draft.workspace !== workspace) return { ok: false, code: "NOT_FOUND", message: "no such package" };
    if (cur.status === "succeeded") {
      const r = await proposeUpdate(ctx, doc!, description, descriptionSources ?? [], "agent");
      if (r.ok) return { ok: true, status: "proposed", updateId: r.id };
      return r.code === "BAD_INPUT" ? { ok: false, code: "BAD_INPUT", problems: r.message.split("; ") } : { ok: false, code: "NOT_READY", message: r.message };
    }
    if (cur.status !== "awaiting_review") return { ok: false, code: "NOT_READY", message: NOT_REVISABLE[cur.status] };
    const problems = [...checkDescriptionChange(cur.draft, description, descriptionSources, privateTerms()), ...(await descriptionEmbargoes(ctx, workspace, description))];
    if (problems.length) return { ok: false, code: "BAD_INPUT", problems };
    const sources = (descriptionSources as { claim: string; source: string }[] | undefined)?.map((e) => ({ claim: e.claim, source: e.source }));
    try {
      const next = await gateFor(ctx).revise(packageId, { ...cur.draft, description, descriptionSources: sources });
      return { ok: true, status: next.status };
    } catch (e) {
      if (e instanceof GateError) return { ok: false, code: e.code === "PACKAGE_CHANGED" ? "PACKAGE_CHANGED" : "NOT_READY", message: e.message };
      throw e;
    }
  },
});

/**
 * Internal (the agent's /agent/packages/get): what the agent needs to rewrite a description, read-only, in its token's
 * workspace only. For a show on Mixcloud the description is the live one (R10) and the open update's status is named.
 * Only the listed fields leave: never the cover, the MP3 or hour ids, the receipt, the hash or who decided.
 */
export const agentGet = internalQuery({
  args: { workspace: v.union(v.literal("real"), v.literal("demo")), packageId: v.string() },
  handler: async (ctx, { workspace, packageId }) => {
    const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
    const draft = doc && asDraft(doc.draft);
    // The other workspace's package answers exactly like a missing one, so a token cannot probe for ids.
    if (!doc || !draft || draft.workspace !== workspace) return null;
    const updates = doc.status === "succeeded" ? await updatesOf(ctx, packageId) : [];
    const live = doc.status === "succeeded" ? liveOf(doc, updates) : draft;
    const open = updates.find(isOpen);
    // Plan 8: why Approve or a description would be refused, as text only: no release id, player or link.
    const embargo = await embargoProblems(ctx, workspace, { description: live.description, tracks: draft.tracks });
    return {
      packageId: doc.packageId, showDate: draft.showDate, status: doc.status, title: draft.title, tags: draft.tags,
      tracklistText: formatTracklist(draft.tracks), description: live.description,
      ...(live.descriptionSources?.length && { descriptionSources: live.descriptionSources }),
      ...(open && { openUpdate: open.status }),
      ...((embargo.blocking.length || embargo.sameArtist.length) && { embargo }),
    };
  },
});

const audioV = v.object({
  hour1Id: v.string(),
  hour2Id: v.string(),
  mp3Sha256: v.string(),
  hour1DurationSec: v.optional(v.number()),
  mp3Bytes: v.optional(v.number()),
});

export const attachAudio = internalMutation({
  args: { packageId: v.string(), audio: audioV },
  handler: (ctx, { packageId, audio }) => gateFor(ctx).attachAudio(packageId, audio),
});

export const claimForPublish = internalMutation({
  args: { packageId: v.string() },
  handler: (ctx, { packageId }) => gateFor(ctx).claimForPublish(packageId),
});

const publishResultV = v.union(
  v.object({ status: v.literal("succeeded"), url: v.string() }),
  v.object({ status: v.literal("failed"), error: v.string() }),
  v.object({ status: v.literal("outcome_unknown") }),
);

export const recordResult = internalMutation({
  args: { packageId: v.string(), result: publishResultV },
  handler: (ctx, { packageId, result }) => gateFor(ctx).recordResult(packageId, result),
});

