import { chicagoDayKey, isEmbargoActive } from "@aircheck/core";
import { query } from "./_generated/server";
import { digestCutoff } from "./cutoff";
import { actorOf, workspaceOf } from "./gate";
import { statusOf } from "./radar";

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

    const now = Date.now();
    const cutoff = digestCutoff(now);
    // Plan 8: new records received since the cutoff. An embargoed one is counted, never named: no title, label or row
    // of it reaches the digest (job 9 sends counts and labels to Telegram).
    const fresh = (await ctx.db.query("releases").withIndex("by_workspace", (q) => q.eq("workspace", ws)).collect())
      .filter((r) => statusOf(r) === "new" && (r.receivedAt ?? 0) >= cutoff)
      .sort((a, b) => b.receivedAt! - a.receivedAt!);
    const today = chicagoDayKey(now);
    const shown = fresh.filter((r) => !isEmbargoActive(r.embargo, today));
    const labels = [...new Set(shown.map((r) => r.label).filter((l): l is string => !!l))];
    const byTab = { bandcamp: 0, cosign: 0 };
    for (const r of fresh) byTab[r.source ?? "bandcamp"] += 1;

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
      releases: {
        count: fresh.length,
        labels,
        // Only what the card shows: never senders, links, players or edit marks.
        items: shown.slice(0, 2).map((r) => ({ artist: r.artist, title: r.title, ...(r.label && { label: r.label }), ...(r.type && { type: r.type }), tab: r.source ?? ("bandcamp" as const) })),
        embargoed: fresh.length - shown.length,
        byTab,
      },
      blockedSince: blocked.length,
      blockedLatest: latest ? { title: latest.title, destination: latest.destination } : undefined,
    };
  },
});
