import { initialRun, RUN_INSTRUCTIONS } from "@aircheck/core";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { firstDelayMs } from "./scripted";
import { sessionKeyOf, sourceFor } from "./demoLimits";
import type { Workspace } from "./gate";

export interface NewRun {
  workspace: Workspace;
  kind: "chat" | "draft-package" | "research";
  title: string;
  input: string;
  conversationId?: string;
  form?: { showDate: string; tracklistText: string; notes: string };
  jobId?: string;
}

async function insertRun(ctx: MutationCtx, run: NewRun, source: "live" | "scripted", sessionKey: string | undefined, now: number): Promise<string> {
  const runId = `run-${crypto.randomUUID()}`;
  await ctx.db.insert("runs", {
    workspace: run.workspace,
    runId,
    title: run.title,
    state: initialRun(runId),
    updatedAt: now,
    kind: run.kind,
    source,
    status: source === "live" ? "queued" : "running",
    input: run.input,
    // The fixed scope rides with every live run; scripted runs never reach Hermes.
    instructions: source === "live" ? RUN_INSTRUCTIONS : undefined,
    stopRequested: false,
    conversationId: run.conversationId,
    sessionKey,
    form: run.form,
    jobId: run.jobId,
    createdAt: now,
  });
  return runId;
}

/**
 * Creates a run. Live runs wait as `queued` for the relay; scripted (demo-only) runs start `running`
 * and are replayed by scripted.step. May throw RATE_LIMITED (demo), before anything is written.
 */
export async function enqueueRun(ctx: MutationCtx, run: NewRun): Promise<string> {
  const now = Date.now();
  const sessionKey = run.workspace === "demo" ? await sessionKeyOf(ctx) : undefined;
  const source = await sourceFor(ctx, run.workspace, sessionKey, now);
  const runId = await insertRun(ctx, run, source, sessionKey, now);
  if (source === "scripted") await ctx.scheduler.runAfter(firstDelayMs(), internal.scripted.step, { runId, index: 0 });
  return runId;
}

/**
 * Plan 7 (D11b): a run that must be live or not at all. null (nothing written) where enqueueRun would script it, since
 * the scripted replay is a draft, never research. `sessionKey` is the demo visitor's: given for a continuation, which
 * has no signed-in caller; else read from the caller. May throw RATE_LIMITED (demo), before anything is written.
 */
export async function enqueueLiveRun(ctx: MutationCtx, run: NewRun, sessionKey?: string): Promise<string | null> {
  const now = Date.now();
  const key = run.workspace === "demo" ? (sessionKey ?? (await sessionKeyOf(ctx))) : undefined;
  if ((await sourceFor(ctx, run.workspace, key, now)) !== "live") return null;
  return insertRun(ctx, run, "live", key, now);
}
