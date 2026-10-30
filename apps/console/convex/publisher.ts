import { chicagoDayKey, embargoHits, type PackageDraft } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { sameToken } from "./agentSubmit";
import { requeueStuckUpdates } from "./descriptionUpdates";
import { gateFor, viaGate } from "./gate";
import { writeMixcloudStatus } from "./mixcloud";
import { activeEmbargoes, embargoProblems, markPlayed } from "./radar";
import { finishedVerifyCounts } from "./research";
import { mixcloudStatusFields } from "./schema";

// The publisher service on the VM is the only caller. Every function checks PUBLISHER_TOKEN first, in constant
// time, and fails closed when it is unset or shorter than 32 characters.
// Hard Rule 1: packages are read here, and changed only through the gate's claimForPublish, recordResult and unclaim.
// Equal MEDIA_TOKEN and PUBLISHER_TOKEN (or either equal to INGEST_TOKEN or INBOX_TOKEN) would let one service act as another: refuse everything (M7).
export function requirePublisher(token: string): void {
  const { MEDIA_TOKEN, PUBLISHER_TOKEN, INGEST_TOKEN, INBOX_TOKEN } = process.env;
  if (MEDIA_TOKEN === PUBLISHER_TOKEN || PUBLISHER_TOKEN === INGEST_TOKEN || PUBLISHER_TOKEN === INBOX_TOKEN || !sameToken(token, PUBLISHER_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

/**
 * Approved real packages (demo ones never) with the cover the upload will use, and how many went up today
 * (America/Chicago day key `today`, e.g. "2026-10-28") for the 3-per-day pace. Shared by `queue` and the package page's `packages.publishState`.
 * Plan 8: an approved package that an embargo now holds (set after approval) is left out and listed in `held` with why.
 */
export async function publishQueue(ctx: QueryCtx, today: string) {
  const real = (status: "approved" | "succeeded" | "outcome_unknown") =>
    ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", status)).collect();
  const standard = process.env.STANDARD_COVER_STORAGE_ID;
  const active = await activeEmbargoes(ctx, "real", today);
  const held: { packageId: string; reasons: string[] }[] = [];
  const packages = (await real("approved")).flatMap((d) => {
    const draft = d.draft as PackageDraft;
    const { blocking } = embargoHits({ description: draft.description, tracks: draft.tracks }, active);
    if (blocking.length) {
      held.push({ packageId: d.packageId, reasons: blocking });
      return [];
    }
    const coverStorageId = draft.coverStorageId ?? standard;
    return [{
      packageId: d.packageId, showDate: draft.showDate, decidedAt: d.decidedAt, draft, fingerprint: d.fingerprint,
      ...(coverStorageId ? { coverStorageId } : {}),
    }];
  });
  // R10: an unknown outcome may be a real post, so it counts too (pacing errs conservative).
  // ponytail: scans every such result ever (a few a week); add a by-day index if this grows large.
  const results = [...(await real("succeeded")), ...(await real("outcome_unknown"))];
  const publishedToday = results.filter((d) => d.result?.at && chicagoDayKey(Date.parse(d.result.at)) === today).length;
  return { packages, publishedToday, held };
}

export const queue = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requirePublisher(token);
    return publishQueue(ctx, chicagoDayKey(Date.now()));
  },
});

/**
 * Plan 8: an embargo that arrived after approval holds an approved real package. Every claim path calls this first
 * (publisher.claim and the internal packages.claimForPublish); the publisher waits on NOT_READY.
 */
export async function requireNotHeld(ctx: QueryCtx, packageId: string): Promise<void> {
  const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
  if (doc?.workspace !== "real" || doc.status !== "approved") return;
  const draft = doc.draft as PackageDraft;
  const { blocking } = await embargoProblems(ctx, "real", { description: draft.description, tracks: draft.tracks });
  if (blocking.length) throw new ConvexError({ code: "NOT_READY", message: `package ${packageId} is held: ${blocking.join("; ")}` });
}

/** approved -> publishing, at most once. Anything else (never approved, already claimed) is NOT_READY. */
export const claim = mutation({
  args: { token: v.string(), packageId: v.string() },
  handler: async (ctx, { token, packageId }) => {
    requirePublisher(token);
    await requireNotHeld(ctx, packageId);
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
    const rec = await viaGate(() => gateFor(ctx).recordResult(packageId, result));
    // Plan 8: a show that went up played its tracks; matching radar records say so (never a passed one).
    if (rec.status === "succeeded" && rec.draft.workspace === "real") await markPlayed(ctx, rec.draft.tracks);
    return rec;
  },
});

/**
 * publishing -> approved, only when nothing was sent: Mixcloud refused the access token (R23; it checks the token
 * before it takes any audio), or the publisher lost the claim's answer and never started the upload (M3). The
 * package waits, still approved.
 */
export const unclaim = mutation({
  args: { token: v.string(), packageId: v.string() },
  handler: async (ctx, { token, packageId }) => {
    requirePublisher(token);
    return viaGate(() => gateFor(ctx).unclaim(packageId, "invalid_token"));
  },
});

/** Real packages waiting for review, for the Telegram "ready" card (R22). Title and counts only; never demo. */
export const awaitingReview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requirePublisher(token);
    const docs = await ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", "awaiting_review")).collect();
    return docs.map((d) => {
      const draft = d.draft as PackageDraft;
      return { packageId: d.packageId, title: draft.title, trackCount: draft.tracks.length, flagCount: draft.flags?.length ?? 0 };
    });
  },
});

const READY_WINDOW_MS = 48 * 3_600_000;

/**
 * Plan 7: pre-air checks finished in the last 48 hours (real workspace only), as `{ jobId, showDate, changes, open }`.
 * The publisher sends one Telegram line per job with a link to the report in the signed-in console; never its text.
 */
export const researchReady = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requirePublisher(token);
    return finishedVerifyCounts(ctx, Date.now() - READY_WINDOW_MS);
  },
});

/**
 * Run on publisher start (Review Focus 1). A package still `publishing` means the last run stopped mid-upload, so
 * nobody knows whether it posted: it becomes outcome_unknown for Tarik to check, never approved again. Description
 * updates left pushing go back to approved (Plan 5c Task 4).
 */
export const reconcile = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requirePublisher(token);
    const stuck = await ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", "publishing")).collect();
    for (const d of stuck) await viaGate(() => gateFor(ctx).recordResult(d.packageId, { status: "outcome_unknown" }));
    // A description edit is idempotent, so an update left pushing is simply tried again (the try counted).
    await requeueStuckUpdates(ctx);
    return { reconciled: stuck.map((d) => d.packageId) };
  },
});

/**
 * A URL the publisher downloads the cover from. R9: only the standard cover or the cover of a real package that is
 * approved or publishing; anything else is NOT_FOUND (Convex file URLs do not expire, so the set is kept narrow).
 */
export const coverUrl = query({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { token, storageId }) => {
    requirePublisher(token);
    let allowed = storageId === process.env.STANDARD_COVER_STORAGE_ID;
    for (const status of ["approved", "publishing"] as const) {
      if (allowed) break;
      const docs = await ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", status)).collect();
      allowed = docs.some((d) => (d.draft as PackageDraft).coverStorageId === storageId);
    }
    const url = allowed ? await ctx.storage.getUrl(storageId) : null;
    if (!url) throw new ConvexError({ code: "NOT_FOUND" });
    return url;
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
