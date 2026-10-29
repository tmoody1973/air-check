import { checkDescriptionChange, chicagoDayKey, embargoHits, updateFingerprint, type PackageDraft } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { privateTerms } from "./agentSubmit";
import { actorOf, workspaceOf } from "./gate";
import { requirePublisher } from "./publisher";
import { activeEmbargoes, descriptionEmbargoes } from "./radar";

// Plan 5c Task 4: a new description for a show already on Mixcloud. Hard Rule 1: the agent or a human proposes; only a
// signed-in real human approves the exact text (its fingerprint); the publisher claims only `approved` updates. The
// package itself never changes (R10): the live description is the latest pushed update, else the draft's.

type Sources = { claim: string; source: string }[];
type Update = Doc<"descriptionUpdates">;
const MAX_ATTEMPTS = 3;
const OPEN = ["proposed", "approved", "pushing"] as const;

export type UpdateResult =
  | { ok: true; id: Id<"descriptionUpdates">; replaced: boolean }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "NOT_READY" | "BAD_INPUT" | "PACKAGE_CHANGED"; message: string };

export const updatesOf = (ctx: QueryCtx, packageId: string) =>
  ctx.db.query("descriptionUpdates").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).collect(); // oldest first

/** Proposed, approved or pushing: not finished yet. At most one per package. */
export const isOpen = (u: Update) => (OPEN as readonly string[]).includes(u.status);

/** What Mixcloud shows now: the latest pushed update, else the description the show went up with. */
export function liveOf(pkg: Doc<"packages">, updates: Update[]) {
  const pushed = updates.filter((u) => u.status === "pushed").at(-1);
  if (pushed) return { description: pushed.description, ...(pushed.descriptionSources && { descriptionSources: pushed.descriptionSources }), ...(pushed.pushedAt && { updatedAt: pushed.pushedAt }) };
  const draft = pkg.draft as PackageDraft;
  return { description: draft.description, ...(draft.descriptionSources && { descriptionSources: draft.descriptionSources }) };
}

/**
 * The one way an update is proposed (the console's human and the agent's revise route). The caller has already
 * checked who is asking and that the package is in their workspace. `sources` undefined keeps the sources of the
 * text being replaced (an open proposal's, else the live one's), like the pre-approval edit keeps the draft's.
 */
export async function proposeUpdate(
  ctx: MutationCtx, pkg: Doc<"packages">, description: string, sources: unknown, proposedBy: "agent" | "human",
): Promise<UpdateResult> {
  const draft = pkg.draft as PackageDraft;
  // Hard Rule 9: demo packages never publish, so they never get an update either.
  if (pkg.workspace !== "real" || draft.workspace !== "real") return { ok: false, code: "NOT_READY", message: "demo packages are never published, so they cannot be updated" };
  if (pkg.status !== "succeeded") return { ok: false, code: "NOT_READY", message: "only a show already on Mixcloud can have its description updated" };
  const problems = [...checkDescriptionChange(draft, description, sources, privateTerms()), ...(await descriptionEmbargoes(ctx, "real", description))];
  if (problems.length) return { ok: false, code: "BAD_INPUT", message: problems.join("; ") };
  const updates = await updatesOf(ctx, pkg.packageId);
  const live = liveOf(pkg, updates);
  if (description === live.description) return { ok: false, code: "BAD_INPUT", message: "That is already the description on Mixcloud." };
  const open = updates.filter(isOpen);
  if (open.some((u) => u.status !== "proposed"))
    return { ok: false, code: "NOT_READY", message: "an approved update is being sent to Mixcloud; propose again once it finishes" };
  const replacing = open.at(-1);
  const given = sources === undefined ? (replacing?.descriptionSources ?? live.descriptionSources) : (sources as Sources).map((s) => ({ claim: s.claim, source: s.source }));
  const kept = given?.length ? given : undefined;
  for (const u of open) await ctx.db.delete(u._id); // superseded: at most one open update per package
  const id = await ctx.db.insert("descriptionUpdates", {
    packageId: pkg.packageId, description, ...(kept && { descriptionSources: kept }), status: "proposed", proposedBy,
    fingerprint: await updateFingerprint(description, kept), attempts: 0,
  });
  return { ok: true, id, replaced: open.length > 0 };
}

const FORBIDDEN = { ok: false, code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can do this" } as const;

/** A package by id for a signed-in real human: null for anyone else and for a demo package (same answer). */
async function staffPackage(ctx: QueryCtx, packageId: string) {
  if (workspaceOf(await actorOf(ctx)) !== "real") return null;
  return ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
}

/** A signed-in real human proposes new text for a show on Mixcloud. It still needs Approve update. */
export const propose = mutation({
  args: { packageId: v.string(), description: v.string() },
  handler: async (ctx, { packageId, description }): Promise<UpdateResult> => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return FORBIDDEN;
    const pkg = await staffPackage(ctx, packageId);
    if (pkg && pkg.workspace !== "real") return FORBIDDEN;
    if (!pkg) return { ok: false, code: "NOT_FOUND", message: "no such package" };
    return proposeUpdate(ctx, pkg, description, undefined, "human");
  },
});

/** Hard Rule 1: a signed-in real human approves the proposed text they saw (its fingerprint), and nothing else. */
export const approve = mutation({
  args: { id: v.id("descriptionUpdates"), fingerprint: v.string() },
  handler: async (ctx, { id, fingerprint }): Promise<{ ok: true } | Exclude<UpdateResult, { ok: true }>> => {
    const actor = await actorOf(ctx);
    if (workspaceOf(actor) !== "real" || actor?.kind !== "human") return FORBIDDEN;
    const u = await ctx.db.get(id);
    // A proposal replaced by a newer one is gone: the host was reading old text.
    if (!u) return { ok: false, code: "PACKAGE_CHANGED", message: "This proposal was replaced. Review the latest version." };
    const pkg = await staffPackage(ctx, u.packageId);
    if (!pkg || pkg.workspace !== "real") return FORBIDDEN;
    if (u.status !== "proposed") return { ok: false, code: "NOT_READY", message: "this update is no longer waiting for approval" };
    if (u.fingerprint !== fingerprint) return { ok: false, code: "PACKAGE_CHANGED", message: "This proposal changed. Review the latest version." };
    await ctx.db.patch(id, { status: "approved", approvedBy: actor.email, approvedAt: new Date().toISOString() });
    return { ok: true };
  },
});

/** The package page: what Mixcloud shows now and the latest update. Signed-in real humans only; null otherwise. */
export const forPackage = query({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }) => {
    const pkg = await staffPackage(ctx, packageId);
    if (!pkg || pkg.workspace !== "real") return null;
    const updates = await updatesOf(ctx, packageId);
    const u = updates.at(-1);
    return {
      live: liveOf(pkg, updates),
      latest: u
        ? {
            id: u._id, status: u.status, description: u.description, proposedBy: u.proposedBy, fingerprint: u.fingerprint,
            ...(u.descriptionSources && { descriptionSources: u.descriptionSources }),
            ...(u.error && { error: u.error }), ...(u.pushedAt && { pushedAt: u.pushedAt }), ...(u.approvedAt && { approvedAt: u.approvedAt }),
          }
        : null,
    };
  },
});

/**
 * A try that ended without a clear answer: back to approved (an edit is idempotent), or failed after the third, with
 * `unconfirmed` when Mixcloud took the last one without confirming it (it may be live) and `retries_exhausted` otherwise.
 */
async function retryLater(ctx: MutationCtx, u: Update, error: "retries_exhausted" | "unconfirmed" = "retries_exhausted") {
  const attempts = u.attempts + 1;
  await ctx.db.patch(u._id, attempts >= MAX_ATTEMPTS ? { status: "failed", attempts, error } : { status: "approved", attempts });
}

/**
 * Updates left `pushing` (the publisher restarted, or lost a claim's answer) go back to approved with the try counted.
 * Run by publisher.reconcile at start and before every claim: the publisher is single-flight, so a pushing row at
 * claim time is always an orphan.
 */
export async function requeueStuckUpdates(ctx: MutationCtx): Promise<void> {
  for (const u of await ctx.db.query("descriptionUpdates").withIndex("by_status", (q) => q.eq("status", "pushing")).collect()) await retryLater(ctx, u);
}

/** Publisher only: the oldest approved update -> pushing, with the show's address from the package's own receipt. */
export const claim = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requirePublisher(token);
    await requeueStuckUpdates(ctx);
    // Plan 8: an update approved before an embargo arrived waits, approved, until the embargo ends or is cleared.
    const active = await activeEmbargoes(ctx, "real", chicagoDayKey(Date.now()));
    const approved = await ctx.db.query("descriptionUpdates").withIndex("by_status", (q) => q.eq("status", "approved")).collect();
    const u = approved.find((x) => !embargoHits({ description: x.description }, active).blocking.length);
    if (!u) return null;
    const pkg = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", u.packageId)).unique();
    // Hard Rule 9 again, and the show must really be on Mixcloud: its receipt is the only source of the edit URL.
    const url = pkg?.status === "succeeded" && pkg.workspace === "real" && (pkg.draft as PackageDraft).workspace === "real" ? pkg.result?.url : undefined;
    if (!url) {
      await ctx.db.patch(u._id, { status: "failed", error: "not_published" });
      return null;
    }
    await ctx.db.patch(u._id, { status: "pushing" });
    return { id: u._id, packageId: u.packageId, description: u.description, showUrl: url };
  },
});

const outcomeV = v.union(
  v.object({ status: v.literal("pushed") }),
  v.object({ status: v.literal("failed"), error: v.string() }),
  v.object({ status: v.literal("retry") }), // no answer, a timeout, a 5xx or a rate limit
  v.object({ status: v.literal("unconfirmed") }), // a 2xx without success: true; may already be live
  v.object({ status: v.literal("unclaim") }), // Mixcloud refused the key: nothing was sent
);

/** Publisher only: how a push ended. From pushing only, so a repeated write (lost answer) is NOT_READY. */
export const record = mutation({
  args: { token: v.string(), id: v.id("descriptionUpdates"), outcome: outcomeV },
  handler: async (ctx, { token, id, outcome }) => {
    requirePublisher(token);
    const u = await ctx.db.get(id);
    if (u?.status !== "pushing") throw new ConvexError({ code: "NOT_READY", message: "update is not being pushed" });
    if (outcome.status === "pushed") await ctx.db.patch(id, { status: "pushed", pushedAt: new Date().toISOString() });
    else if (outcome.status === "failed") await ctx.db.patch(id, { status: "failed", error: outcome.error.slice(0, 60) });
    else if (outcome.status === "unclaim") await ctx.db.patch(id, { status: "approved" });
    else await retryLater(ctx, u, outcome.status === "unconfirmed" ? "unconfirmed" : "retries_exhausted");
  },
});
