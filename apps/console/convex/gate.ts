import { ApprovalGate, type Actor, actorFromIdentity } from "@aircheck/core";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { convexPackageStore } from "./packageStore";

export type Workspace = "real" | "demo";

/** Clerk custom session claims may arrive as strings; the role claim is server-controlled (public_metadata). */
export async function actorOf(ctx: QueryCtx | MutationCtx): Promise<Actor | null> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) return null;
  const extra = id as Record<string, unknown>;
  const verified = extra.emailVerified === true || extra.email_verified === true || extra.email_verified === "true";
  return actorFromIdentity({
    subject: id.subject,
    email: id.email,
    emailVerified: verified,
    role: typeof extra.role === "string" ? extra.role : undefined,
  });
}

export function workspaceOf(actor: Actor | null): Workspace | null {
  return actor?.kind === "demo" ? "demo" : actor?.kind === "human" ? "real" : null;
}

const ACTIVITY: Record<string, { kind: "waiting" | "action"; result: "needs_you" | "done"; title: (t: string) => string }> = {
  awaiting_review: { kind: "waiting", result: "needs_you", title: () => "Package ready for your approval" },
  approved: { kind: "action", result: "done", title: (t) => `Approved package ${t}` },
  skipped: { kind: "action", result: "done", title: (t) => `Skipped package ${t}` },
};

/** A gate whose transitions write their activity row in the same mutation. Other transitions write none (Plan 5 adds publish rows). */
export function gateFor(ctx: MutationCtx) {
  const store = convexPackageStore(ctx);
  return new ApprovalGate(store, {
    onTransition: async (t) => {
      const spec = ACTIVITY[t.to];
      const rec = await store.get(t.id);
      if (!spec || !rec) return;
      await ctx.db.insert("activity", {
        workspace: rec.draft.workspace,
        at: Date.parse(t.at),
        kind: spec.kind,
        result: spec.result,
        title: spec.title(rec.draft.title),
        packageId: t.id,
      });
    },
  });
}

export type { Id };
