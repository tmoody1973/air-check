import { type RunState } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { sameToken } from "./agentSubmit";
import { applyEvents } from "./applyEvents";

// The relay (a host program) is the only caller. Every function checks its token first, in constant time,
// and fails closed: RELAY_TOKEN unset or shorter than 32 characters means nothing here works.
function requireRelay(token: string): void {
  if (!sameToken(token, process.env.RELAY_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

const TERMINAL = ["completed", "cancelled", "failed"];
const workspaceV = v.union(v.literal("real"), v.literal("demo"));

async function findRun(ctx: QueryCtx, runId: string): Promise<Doc<"runs">> {
  const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", runId)).unique();
  if (!run || run.source !== "live") throw new ConvexError({ code: "NOT_FOUND" });
  return run;
}

/** Live runs waiting to start, plus runs the user asked to stop. Scripted runs never appear. */
export const pending = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireRelay(token);
    const byStatus = (status: "queued" | "stopping") => ctx.db.query("runs").withIndex("by_status", (q) => q.eq("status", status)).collect();
    const [queued, stopping] = await Promise.all([byStatus("queued"), byStatus("stopping")]);
    return [...queued, ...stopping.filter((r) => r.stopRequested)]
      .filter((r) => r.source === "live")
      .map((r) => ({
        runId: r.runId, workspace: r.workspace, kind: r.kind, input: r.input, conversationId: r.conversationId,
        stopRequested: r.stopRequested, hermesRunId: r.hermesRunId,
      }));
  },
});

/** queued -> running. `started: false` means the run was cancelled meanwhile, so the relay must not start Hermes. */
export const started = mutation({
  args: { token: v.string(), runId: v.string(), hermesRunId: v.string() },
  handler: async (ctx, { token, runId, hermesRunId }) => {
    requireRelay(token);
    const run = await findRun(ctx, runId);
    if (run.status === "queued") {
      await ctx.db.patch(run._id, { status: "running", hermesRunId, updatedAt: Date.now() });
      return { started: true };
    }
    return { started: run.status === "running" && run.hermesRunId === hermesRunId };
  },
});

const ID_IN_TEXT = /\b(?:pkg|demo)-\d{1,2}-\d{1,2}-\d{2}\b/g;

/** R2: the first package id the run produced that really exists in the run's own workspace. */
async function packageIdFor(ctx: MutationCtx, run: Doc<"runs">, state: RunState, batch: readonly { event: string; data: Record<string, unknown> }[]): Promise<string | undefined> {
  const submitted = batch.filter((e) => e.event === "tool.completed" && String(e.data.tool ?? e.data.tool_name ?? e.data.name ?? "").endsWith("package_submit"));
  const text = [...submitted.map((e) => JSON.stringify(e.data)), state.output ?? "", state.reply ?? ""].join("\n");
  for (const id of new Set(text.match(ID_IN_TEXT) ?? [])) {
    // The same id can exist in both workspaces, so filter by the run's workspace.
    const same = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).collect();
    if (same.some((p) => p.workspace === run.workspace)) return id;
  }
  return undefined;
}

const eventV = v.object({ event: v.string(), data: v.record(v.string(), v.any()), t: v.number(), seq: v.number() });

export const events = mutation({
  args: { token: v.string(), runId: v.string(), events: v.array(eventV) },
  handler: async (ctx, { token, runId, events }) => {
    requireRelay(token);
    const run = await findRun(ctx, runId);
    if (TERMINAL.includes(run.status)) return;
    const state = await applyEvents(ctx, run, events);
    const packageId = await packageIdFor(ctx, run, state, events);
    if (packageId && packageId !== run.packageId) await ctx.db.patch(run._id, { packageId });
  },
});

export const finished = mutation({
  args: { token: v.string(), runId: v.string(), status: v.union(v.literal("completed"), v.literal("cancelled"), v.literal("failed")) },
  handler: async (ctx, { token, runId, status }) => {
    requireRelay(token);
    const run = await findRun(ctx, runId);
    if (TERMINAL.includes(run.status)) return;
    const state = run.state as RunState;
    const settled = state.status === "running" || state.status === "stopping";
    await ctx.db.patch(run._id, { status, state: settled ? { ...state, status } : state, updatedAt: Date.now() });
  },
});

const auditV = v.object({
  key: v.string(), at: v.number(), decision: v.union(v.literal("allowed"), v.literal("blocked")),
  host: v.string(), port: v.number(), binary: v.optional(v.string()), reason: v.optional(v.string()),
});

/** Sandbox network decisions from the audit log -> Trust-page rows. A key already stored for the workspace is skipped. */
export const activity = mutation({
  args: { token: v.string(), workspace: workspaceV, events: v.array(auditV) },
  handler: async (ctx, { token, workspace, events }) => {
    requireRelay(token);
    for (const e of events) {
      const seen = await ctx.db.query("activity").withIndex("by_workspace_key", (q) => q.eq("workspace", workspace).eq("key", e.key)).first();
      if (seen) continue;
      await ctx.db.insert("activity", {
        workspace, key: e.key, at: e.at, kind: "network", result: e.decision,
        title: e.decision === "blocked" ? "Blocked connection" : "Connection",
        destination: `${e.host}:${e.port}`, reason: e.reason,
      });
    }
  },
});
