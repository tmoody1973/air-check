import { GateError, type GateErrorCode, type PackageDraft, type PackageRecord } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { actorOf, gateFor, workspaceOf } from "./gate";
import { toRecord } from "./packageStore";

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

export type DecideResult = { ok: true; record: PackageRecord } | { ok: false; code: GateErrorCode; message: string };

/** The only public mutation on packages (Hard Rule 1). */
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

