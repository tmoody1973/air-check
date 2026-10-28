import { GateError, publishDayOffset, type GateErrorCode, type PackageDraft, type PackageRecord } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { actorOf, gateFor, workspaceOf } from "./gate";
import type { MixcloudStatus } from "./mixcloud";
import { toRecord } from "./packageStore";
import { publishQueue } from "./publisher";

const asDraft = (d: unknown) => d as PackageDraft;

export const get = query({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }): Promise<PackageRecord | null> => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    const doc = await ctx.db
      .query("packages")
      .withIndex("by_packageId", (q) => q.eq("packageId", packageId))
      .unique();
    return doc && doc.draft.workspace === ws ? toRecord(doc) : null;
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

export type PublishState = { dayOffset: number | null; mixcloudState: MixcloudStatus["state"] };

/**
 * R2: which Chicago day an approved package should go up (0 = today), from the same queue and count the publisher
 * uses. Like the publisher, a package with no cover (its own or the standard one) is not queued.
 */
export const publishState = query({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }): Promise<PublishState | null> => {
    if (!(await realPackage(ctx, packageId))) return null;
    const { packages, publishedToday } = await publishQueue(ctx);
    // Same mapping as the publisher service's nextToPublish call (apps/publisher/src/publish.ts).
    const approved = packages
      .filter((p) => p.coverStorageId)
      .map((p) => ({ packageId: p.packageId, showDate: p.showDate, approvedAt: p.decidedAt ?? "" }));
    const mixcloudState = (await ctx.db.query("mixcloudStatus").first())?.state ?? "not_connected";
    return { dayOffset: publishDayOffset(approved, publishedToday, packageId, 3), mixcloudState };
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
export type CoverResult = DecideResult | { ok: false; code: "BAD_INPUT"; message: string };

/** The only public mutation that decides a package (Hard Rule 1). */
export const decide = mutation({
  args: { packageId: v.string(), fingerprint: v.string(), decision: v.union(v.literal("approve"), v.literal("skip")) },
  handler: async (ctx, { packageId, fingerprint, decision }): Promise<DecideResult> => {
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

/** A one-time Convex storage upload URL for a cover image. A signed-in real human only. */
export const coverUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") throw new ConvexError({ code: "FORBIDDEN" });
    return ctx.storage.generateUploadUrl();
  },
});

// Internal: reachable only with the deploy key (Plans 4 and 5).
export const submit = internalMutation({
  args: { draft: v.any() },
  handler: async (ctx, { draft }) => {
    try {
      return await gateFor(ctx).submit(asDraft(draft));
    } catch (e) {
      // Only ConvexError data survives the hop to an HTTP action on a deployed backend.
      if (e instanceof GateError) throw new ConvexError({ code: e.code, message: e.message });
      throw e;
    }
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

