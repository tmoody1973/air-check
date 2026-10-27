import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { enqueueRun } from "./enqueue";
import { actorOf, workspaceOf } from "./gate";

const MAX_TEXT = 8_000;
const TITLE_CHARS = 60;

/** Signed-in chat message: stores the message pair and queues one run. Hermes keeps the history (session_id = conversationId). */
export const send = mutation({
  args: { conversationId: v.optional(v.string()), text: v.string() },
  handler: async (ctx, { conversationId, text }) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const body = text.trim();
    if (!body || body.length > MAX_TEXT) throw new ConvexError({ code: "INVALID_INPUT" });
    const now = Date.now();
    let convId = conversationId ? ctx.db.normalizeId("conversations", conversationId) : null;
    if (conversationId) {
      const conv = convId ? await ctx.db.get(convId) : null;
      if (!convId || !conv || conv.workspace !== ws) throw new ConvexError({ code: "NOT_FOUND" });
    } else {
      convId = await ctx.db.insert("conversations", { workspace: ws, title: body.slice(0, TITLE_CHARS), createdAt: now });
    }
    const runId = await enqueueRun(ctx, { workspace: ws, kind: "chat", title: body.slice(0, TITLE_CHARS), input: body, conversationId: convId });
    await ctx.db.insert("messages", { workspace: ws, conversationId: convId, role: "user", text: body, at: now });
    await ctx.db.insert("messages", { workspace: ws, conversationId: convId, role: "assistant", text: "", runId, at: now });
    return { conversationId: convId as string, runId };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return [];
    return ctx.db.query("conversations").withIndex("by_workspace_created", (q) => q.eq("workspace", ws)).order("desc").take(50);
  },
});

export const messages = query({
  args: { conversationId: v.string() },
  handler: async (ctx, { conversationId }) => {
    const ws = workspaceOf(await actorOf(ctx));
    const id = ctx.db.normalizeId("conversations", conversationId);
    const conv = ws && id ? await ctx.db.get(id) : null;
    if (!id || !conv || conv.workspace !== ws) return [];
    return ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", id)).order("asc").collect();
  },
});
