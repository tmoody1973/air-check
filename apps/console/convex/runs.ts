import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { actorOf, workspaceOf } from "./gate";
import { sourceOf, statusOf } from "./runDefaults";

/** One run for the caller's workspace. Missing and other-workspace both return null, so nothing leaks. */
export const get = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", runId)).unique();
    if (!run || run.workspace !== ws) return null;
    return {
      runId: run.runId, title: run.title, state: run.state, upcoming: run.upcoming,
      kind: run.kind, source: sourceOf(run), status: statusOf(run) ?? "running", stopRequested: run.stopRequested ?? false,
      packageId: run.packageId, conversationId: run.conversationId, form: run.form,
    };
  },
});

/**
 * Stop button. queued (or a scripted run) -> cancelled, Hermes never started or the replay halts;
 * running -> stopping + stopRequested, which the relay picks up; anything finished is left alone.
 */
export const requestStop = mutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const ws = workspaceOf(await actorOf(ctx));
    const run = ws ? await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", runId)).unique() : null;
    if (!run || run.workspace !== ws) throw new ConvexError({ code: "NOT_FOUND" });
    const now = Date.now();
    const status = statusOf(run);
    if (status === "queued" || (status === "running" && sourceOf(run) === "scripted")) {
      await ctx.db.patch(run._id, { status: "cancelled", state: { ...run.state, status: "cancelled" }, updatedAt: now });
    } else if (status === "running") {
      await ctx.db.patch(run._id, { status: "stopping", stopRequested: true, state: { ...run.state, status: "stopping" }, updatedAt: now });
    }
  },
});
