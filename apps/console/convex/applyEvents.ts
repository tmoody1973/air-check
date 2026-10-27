import { applyRunEvent, type RunState } from "@aircheck/core";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export interface IncomingEvent { event: string; data: Record<string, unknown>; t: number; seq?: number } // seq is required at the relay boundary; scripted events carry none

/**
 * Applies events to a run in order and mirrors the reply onto the run's assistant message.
 * An event with `seq` at or below the run's lastSeq is a replay and is skipped (core's steps
 * are keyed by position, so the same batch twice would otherwise duplicate steps).
 */
export async function applyEvents(ctx: MutationCtx, run: Doc<"runs">, events: readonly IncomingEvent[]): Promise<RunState> {
  let state = run.state as RunState;
  let lastSeq = run.lastSeq;
  const at = Date.now();
  for (const e of events) {
    if (e.seq !== undefined) {
      if (lastSeq !== undefined && e.seq <= lastSeq) continue;
      lastSeq = e.seq;
    }
    state = applyRunEvent(state, e.event, e.data, at);
  }
  await ctx.db.patch(run._id, { state, updatedAt: at, ...(lastSeq !== undefined && { lastSeq }) });
  if (state.reply !== undefined) {
    const msgs = await ctx.db.query("messages").withIndex("by_runId", (q) => q.eq("runId", run.runId)).collect();
    const assistant = msgs.find((m) => m.role === "assistant");
    if (assistant && assistant.text !== state.reply) await ctx.db.patch(assistant._id, { text: state.reply });
  }
  return state;
}
