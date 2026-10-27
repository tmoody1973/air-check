import { type RunState } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { sameToken } from "./agentSubmit";
import { applyEvents } from "./applyEvents";
import { isTerminal, sourceOf, statusOf } from "./runDefaults";

// The relay (a host program) is the only caller. Every function checks its token first, in constant time,
// and fails closed: RELAY_TOKEN unset or shorter than 32 characters means nothing here works.
function requireRelay(token: string): void {
  if (!sameToken(token, process.env.RELAY_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

const workspaceV = v.union(v.literal("real"), v.literal("demo"));

async function findRun(ctx: QueryCtx, runId: string): Promise<Doc<"runs">> {
  const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", runId)).unique();
  if (!run || sourceOf(run) !== "live") throw new ConvexError({ code: "NOT_FOUND" });
  return run;
}

/**
 * Live runs the relay must act on: queued (to start), stopping (to stop), and running (so a restarted
 * relay can pick its streams back up). Scripted runs never appear.
 */
export const pending = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireRelay(token);
    const byStatus = (status: "queued" | "stopping" | "running") => ctx.db.query("runs").withIndex("by_status", (q) => q.eq("status", status)).collect();
    const [queued, stopping, running] = await Promise.all([byStatus("queued"), byStatus("stopping"), byStatus("running")]);
    return [...queued, ...stopping.filter((r) => r.stopRequested), ...running]
      // Old rows lacking status/kind/input are never handed to the relay.
      .flatMap((r) =>
        r.status && r.kind && r.input !== undefined && sourceOf(r) === "live"
          ? [{
              runId: r.runId, workspace: r.workspace, kind: r.kind, input: r.input, conversationId: r.conversationId,
              stopRequested: r.stopRequested ?? false, hermesRunId: r.hermesRunId, status: r.status, lastSeq: r.lastSeq,
            }]
          : [],
      );
  },
});

/** queued -> running. `started: false` means the run was cancelled meanwhile, so the relay must not start Hermes. */
export const started = mutation({
  args: { token: v.string(), runId: v.string(), hermesRunId: v.string() },
  handler: async (ctx, { token, runId, hermesRunId }) => {
    requireRelay(token);
    const run = await findRun(ctx, runId);
    if (statusOf(run) === "queued") {
      await ctx.db.patch(run._id, { status: "running", hermesRunId, updatedAt: Date.now() });
      return { started: true };
    }
    return { started: statusOf(run) === "running" && run.hermesRunId === hermesRunId };
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
    if (isTerminal(statusOf(run))) return;
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
    if (isTerminal(statusOf(run))) return;
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

/** Sandbox phase and allowed-host count, sent by the relay every few minutes. One row per workspace (upsert). */
export const status = mutation({
  args: { token: v.string(), workspace: workspaceV, phase: v.union(v.string(), v.null()), allowedHosts: v.number() },
  handler: async (ctx, { token, workspace, phase, allowedHosts }) => {
    requireRelay(token);
    const row = { workspace, phase, allowedHosts, at: Date.now() };
    const existing = await ctx.db.query("sandboxStatus").withIndex("by_workspace", (q) => q.eq("workspace", workspace)).first();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("sandboxStatus", row);
  },
});
