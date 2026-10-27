import { draftPackageInput } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { enqueueRun } from "./enqueue";
import { actorOf, workspaceOf } from "./gate";

const MAX_TRACKLIST = 50_000;
const MAX_NOTES = 20_000;

/** Signed-in "Draft a package" form: queues a draft-package run whose instruction is built here, in code. */
export const draft = mutation({
  args: { showDate: v.string(), tracklistText: v.string(), notes: v.string() },
  handler: async (ctx, form) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(form.showDate) && form.tracklistText.trim() !== "" && form.tracklistText.length <= MAX_TRACKLIST && form.notes.length <= MAX_NOTES;
    if (!ok) throw new ConvexError({ code: "INVALID_INPUT" });
    const runId = await enqueueRun(ctx, {
      workspace: ws,
      kind: "draft-package",
      title: `Draft package · ${form.showDate}`,
      input: draftPackageInput(form),
      form,
    });
    return { runId };
  },
});
