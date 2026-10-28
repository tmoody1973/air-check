import { chicagoDayKey, type PackageDraft } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sameToken } from "./agentSubmit";
import { gateFor, viaGate } from "./gate";
import { writeMixcloudStatus } from "./mixcloud";
import { mixcloudStatusFields } from "./schema";

// The publisher service on the VM is the only caller. Every function checks PUBLISHER_TOKEN first, in constant
// time, and fails closed when it is unset or shorter than 32 characters.
// Hard Rule 1: packages are read here, and changed only through the gate's claimForPublish and recordResult.
function requirePublisher(token: string): void {
  if (!sameToken(token, process.env.PUBLISHER_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

/** Approved real packages (demo ones never), and how many went up today (America/Chicago) for the 3-per-day pace. */
export const queue = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requirePublisher(token);
    const real = (status: "approved" | "succeeded") =>
      ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", status)).collect();
    const standard = process.env.STANDARD_COVER_STORAGE_ID;
    const packages = (await real("approved")).map((d) => {
      const draft = d.draft as PackageDraft;
      const coverStorageId = draft.coverStorageId ?? standard;
      return {
        packageId: d.packageId, showDate: draft.showDate, decidedAt: d.decidedAt, draft, fingerprint: d.fingerprint,
        ...(coverStorageId ? { coverStorageId } : {}),
      };
    });
    const today = chicagoDayKey(Date.now());
    // ponytail: scans every success ever (a few a week); add a by-day index if this grows large.
    const publishedToday = (await real("succeeded")).filter((d) => d.result?.at && chicagoDayKey(Date.parse(d.result.at)) === today).length;
    return { packages, publishedToday };
  },
});

/** approved -> publishing, at most once. Anything else (never approved, already claimed) is NOT_READY. */
export const claim = mutation({
  args: { token: v.string(), packageId: v.string() },
  handler: async (ctx, { token, packageId }) => {
    requirePublisher(token);
    const rec = await viaGate(() => gateFor(ctx).claimForPublish(packageId));
    if (!rec) throw new ConvexError({ code: "NOT_READY", message: `package ${packageId} is not approved` });
    return rec;
  },
});

const resultV = v.union(
  v.object({ status: v.literal("succeeded"), url: v.string() }),
  v.object({ status: v.literal("failed"), error: v.string() }),
  v.object({ status: v.literal("outcome_unknown") }),
);

export const result = mutation({
  args: { token: v.string(), packageId: v.string(), result: resultV },
  handler: async (ctx, { token, packageId, result }) => {
    requirePublisher(token);
    return viaGate(() => gateFor(ctx).recordResult(packageId, result));
  },
});

/**
 * Run on publisher start (Review Focus 1). A package still `publishing` means the last run stopped mid-upload, so
 * nobody knows whether it posted: it becomes outcome_unknown for Tarik to check, never approved again.
 */
export const reconcile = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requirePublisher(token);
    const stuck = await ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", "publishing")).collect();
    for (const d of stuck) await viaGate(() => gateFor(ctx).recordResult(d.packageId, { status: "outcome_unknown" }));
    return { reconciled: stuck.map((d) => d.packageId) };
  },
});

/** A URL the publisher downloads the cover from. */
export const coverUrl = query({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { token, storageId }) => {
    requirePublisher(token);
    return ctx.storage.getUrl(storageId);
  },
});

/** The publisher reports what it found reading its token file (missing, rejected, fine). Never the token itself. */
export const setMixcloud = mutation({
  args: { token: v.string(), ...mixcloudStatusFields },
  handler: async (ctx, { token, ...status }) => {
    requirePublisher(token);
    await writeMixcloudStatus(ctx, status);
  },
});
