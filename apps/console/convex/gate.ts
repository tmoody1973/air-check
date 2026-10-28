import { ApprovalGate, type Actor, actorFromIdentity, GateError } from "@aircheck/core";
import { ConvexError } from "convex/values";
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

type ActivitySpec = { kind: "waiting" | "action"; result: "needs_you" | "done"; title: (title: string, id: string) => string };
const ACTIVITY: Record<string, ActivitySpec> = {
  awaiting_review: { kind: "waiting", result: "needs_you", title: () => "Package ready for your approval" },
  approved: { kind: "action", result: "done", title: (t) => `Approved package ${t}` },
  skipped: { kind: "action", result: "done", title: (t) => `Skipped package ${t}` },
  // Publish rows (R11) carry the package id and status only: no title, URL or error text.
  publishing: { kind: "action", result: "done", title: (_t, id) => `Publishing package ${id}` },
  succeeded: { kind: "action", result: "done", title: (_t, id) => `Published package ${id}` },
  failed: { kind: "waiting", result: "needs_you", title: (_t, id) => `Publish failed for package ${id}` },
  outcome_unknown: { kind: "waiting", result: "needs_you", title: (_t, id) => `Publish outcome unknown for package ${id}` },
};

/** A gate whose transitions write their activity row in the same mutation. preparing_audio writes none. */
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
        title: spec.title(rec.draft.title, t.id),
        packageId: t.id,
      });
    },
  });
}

/** Runs a gate call for a token-gated service. Only ConvexError data reaches a remote caller, so a GateError crosses as {code, message}. */
export async function viaGate<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof GateError) throw new ConvexError({ code: e.code, message: e.message });
    throw e;
  }
}
