import { query } from "./_generated/server";
import { digestCutoff } from "./cutoff";
import { actorOf, workspaceOf } from "./gate";

/** The Today digest for the caller's workspace. Every number is counted here, never by the model. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;

    const packages = await ctx.db
      .query("packages")
      .withIndex("by_workspace_status", (q) => q.eq("workspace", ws).eq("status", "awaiting_review"))
      .collect();
    const awaiting = packages.map((p) => ({
      packageId: p.packageId,
      title: p.draft.title as string,
      tracks: (p.draft.tracks as unknown[]).length,
      flags: (p.draft.flags as unknown[] | undefined)?.length ?? 0,
    }));

    const open = async (status: "conflict" | "could-not-verify") =>
      ctx.db.query("verifications").withIndex("by_workspace_status", (q) => q.eq("workspace", ws).eq("status", status)).collect();
    const openClaims = [...(await open("conflict")), ...(await open("could-not-verify"))].map((c) => ({ claim: c.claim, status: c.status }));

    // ponytail: counts every release (no added-at field yet; Plan 5 adds one to window this).
    const releases = await ctx.db.query("releases").withIndex("by_workspace", (q) => q.eq("workspace", ws)).collect();
    const labels = [...new Set(releases.map((r) => r.label).filter((l): l is string => !!l))];

    const cutoff = digestCutoff(Date.now());
    const blocked = (
      await ctx.db
        .query("activity")
        .withIndex("by_workspace_at", (q) => q.eq("workspace", ws).gte("at", cutoff))
        .order("desc")
        .collect()
    ).filter((a) => a.result === "blocked");
    const latest = blocked[0];

    return {
      awaiting,
      openClaims,
      releases: { count: releases.length, labels, items: releases.slice(0, 2) },
      blockedSince: blocked.length,
      blockedLatest: latest ? { title: latest.title, destination: latest.destination } : undefined,
    };
  },
});
