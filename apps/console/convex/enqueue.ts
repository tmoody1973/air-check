import { initialRun, RUN_INSTRUCTIONS } from "@aircheck/core";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { firstDelayMs } from "./scripted";
import { sessionKeyOf, sourceFor } from "./demoLimits";
import type { Workspace } from "./gate";

export interface NewRun {
  workspace: Workspace;
  kind: "chat" | "draft-package";
  title: string;
  input: string;
  conversationId?: string;
  form?: { showDate: string; tracklistText: string; notes: string };
}

/**
 * Creates a run. Live runs wait as `queued` for the relay; scripted (demo-only) runs start `running`
 * and are replayed by scripted.step. May throw RATE_LIMITED (demo), before anything is written.
 */
export async function enqueueRun(ctx: MutationCtx, run: NewRun): Promise<string> {
  const now = Date.now();
  const sessionKey = run.workspace === "demo" ? await sessionKeyOf(ctx) : undefined;
  const source = await sourceFor(ctx, run.workspace, sessionKey, now);
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
    createdAt: now,
  });
  if (source === "scripted") await ctx.scheduler.runAfter(firstDelayMs(), internal.scripted.step, { runId, index: 0 });
  return runId;
}
