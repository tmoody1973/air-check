import { v } from "convex/values";
import { query } from "./_generated/server";
import { actorOf, workspaceOf } from "./gate";

export const list = query({
  args: { kind: v.optional(v.union(v.literal("waiting"), v.literal("action"), v.literal("network"), v.literal("blocked"))) },
  handler: async (ctx, { kind }) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return [];
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_workspace_at", (q) => q.eq("workspace", ws))
      .order("desc")
      .take(200);
    if (!kind) return rows;
    return rows.filter((r) => (kind === "blocked" ? r.result === "blocked" : r.kind === kind));
  },
});
