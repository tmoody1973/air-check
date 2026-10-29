import { draftPackageInput, type PackageDraftForm } from "@aircheck/core";
import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import { enqueueRun } from "./enqueue";
import { actorOf, workspaceOf, type Workspace } from "./gate";

export const MAX_TRACKLIST = 50_000;
export const MAX_NOTES = 20_000;

/** Queues a draft-package run whose instruction is built here, in code. Shared by the form and the ingest service. */
export function queueDraft(ctx: MutationCtx, workspace: Workspace, form: PackageDraftForm): Promise<string> {
  return enqueueRun(ctx, { workspace, kind: "draft-package", title: `Draft package · ${form.showDate}`, input: draftPackageInput(form), form });
}

/** Signed-in "Draft a package" form: queues a draft-package run whose instruction is built here, in code. */
export const draft = mutation({
  args: { showDate: v.string(), tracklistText: v.string(), notes: v.string() },
  handler: async (ctx, form) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(form.showDate) && form.tracklistText.trim() !== "" && form.tracklistText.length <= MAX_TRACKLIST && form.notes.length <= MAX_NOTES;
    if (!ok) throw new ConvexError({ code: "INVALID_INPUT" });
    return { runId: await queueDraft(ctx, ws, form) };
  },
});
