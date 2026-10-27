import { v } from "convex/values";
import { query } from "./_generated/server";
import { actorOf, workspaceOf } from "./gate";

/** One run for the caller's workspace. Missing and other-workspace both return null, so nothing leaks. */
export const get = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", runId)).unique();
    if (!run || run.workspace !== ws) return null;
    return { runId: run.runId, title: run.title, state: run.state, upcoming: run.upcoming };
  },
});
