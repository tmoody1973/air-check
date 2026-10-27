import { query } from "./_generated/server";
import { actorOf, workspaceOf } from "./gate";

/** The caller's workspace sandbox status row (written by the relay), or null. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    return ctx.db.query("sandboxStatus").withIndex("by_workspace", (q) => q.eq("workspace", ws)).first();
  },
});
