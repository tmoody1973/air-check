import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { applyEvents } from "./applyEvents";
import { SCRIPTED_EVENTS, type ScriptedEvent } from "./scriptedEvents";

const MAX_REPLAY_SECONDS = 60;

/** Milliseconds to wait before playing event `i` (relative to event i-1, or to the start for i = 0); a whole replay is capped at 60 s. */
export function scriptDelayMs(events: readonly ScriptedEvent[], i: number): number {
  const last = events[events.length - 1]?.t ?? 0;
  const scale = last > MAX_REPLAY_SECONDS ? MAX_REPLAY_SECONDS / last : 1;
  const gap = events[i]!.t - (i === 0 ? 0 : events[i - 1]!.t);
  return Math.max(0, Math.round(gap * scale * 1000));
}

/** Plays one stored event on a scripted run, then schedules the next. No-op once the run is no longer running (stopped). */
export const step = internalMutation({
  args: { runId: v.string(), index: v.number() },
  handler: async (ctx, { runId, index }): Promise<void> => {
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", runId)).unique();
    if (!run || run.source !== "scripted" || run.status !== "running") return;
    const e = SCRIPTED_EVENTS[index];
    if (!e) return;
    await applyEvents(ctx, run, [e]);
    if (index + 1 < SCRIPTED_EVENTS.length) {
      await ctx.scheduler.runAfter(scriptDelayMs(SCRIPTED_EVENTS, index + 1), internal.scripted.step, { runId, index: index + 1 });
    } else {
      await ctx.db.patch(run._id, { status: "completed" });
    }
  },
});

export const firstDelayMs = () => scriptDelayMs(SCRIPTED_EVENTS, 0);
