import type { Infer } from "convex/values";
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { actorOf, workspaceOf } from "./gate";
import { mixcloudStatusFields } from "./schema";

// Whether the publisher can reach Mixcloud. Hard Rule 2: never a credential, only state, account name and times.
const statusV = v.object(mixcloudStatusFields);
export type MixcloudStatus = Infer<typeof statusV>;

/** The one status row, replaced whole (so a cleared lastError really clears). */
export async function writeMixcloudStatus(ctx: MutationCtx, status: MixcloudStatus): Promise<void> {
  const row = await ctx.db.query("mixcloudStatus").first();
  if (row) await ctx.db.replace(row._id, status);
  else await ctx.db.insert("mixcloudStatus", status);
}

/** The console's Connect Mixcloud flow, after it wrote the token file. A signed-in real human only. */
export const connected = mutation({
  args: { account: v.string() },
  handler: async (ctx, { account }) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") throw new ConvexError({ code: "FORBIDDEN" });
    await writeMixcloudStatus(ctx, { state: "connected", account, connectedAt: Date.now() });
  },
});

/** Real workspace only; demo and anonymous callers get null. */
export const get = query({
  args: {},
  handler: async (ctx): Promise<MixcloudStatus | null> => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return null;
    const row = await ctx.db.query("mixcloudStatus").first();
    if (!row) return { state: "not_connected" };
    const { _id, _creationTime, ...status } = row;
    void _id, _creationTime;
    return status;
  },
});
