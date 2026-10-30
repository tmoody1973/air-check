import { chicagoDayKey, type ClaimKind, isEmbargoActive, trackEmbargo } from "@aircheck/core";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { digestCutoff } from "./cutoff";
import { actorOf, type Workspace, workspaceOf } from "./gate";
import { activeEmbargoes, statusOf } from "./radar";

const OPEN_CLAIM_DAYS = 14;
const KIND_WORDS: Record<ClaimKind, string> = {
  release: "release", "release-date": "release date", label: "label", credit: "credit", "track-number": "track number",
  length: "length", bio: "bio", detail: "detail", thread: "thread", connection: "connection",
};
type OpenClaim = { jobId: string; label: string; status: "conflict" | "could-not-verify" };

/** "2026-10-29" minus whole days, as a day key. Calendar math on a UTC date, so DST never skips a day. */
function daysBefore(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - n)).toISOString().slice(0, 10);
}

/**
 * Plan 7: conflict and could-not-verify claims in the newest done show-notes or verify job per show date, for show dates
 * from 14 days ago on. Labels are built here from the track's artist and the claim kind ("<Artist> · release date"); a
 * claim on an embargoed track or a private block is counted, never named (Plan 8 rule: the digest reaches Telegram).
 */
async function openClaimsOf(ctx: QueryCtx, ws: Workspace, today: string): Promise<{ openClaims: OpenClaim[]; openClaimsPrivate: number }> {
  const since = daysBefore(today, OPEN_CLAIM_DAYS);
  const recent = async (kind: "show-notes" | "verify") =>
    ctx.db.query("research").withIndex("by_workspace_kind_showDate", (q) => q.eq("workspace", ws).eq("kind", kind).gte("showDate", since)).collect();
  const done = [...(await recent("show-notes")), ...(await recent("verify"))].filter((j) => j.status === "done").sort((a, b) => b.createdAt - a.createdAt);
  const newest = new Map<string, Doc<"research">>();
  for (const j of done) if (!newest.has(j.showDate!)) newest.set(j.showDate!, j);
  const active = await activeEmbargoes(ctx, ws, today);
  const openClaims: OpenClaim[] = [];
  let openClaimsPrivate = 0;
  for (const job of [...newest.values()].sort((a, b) => b.showDate!.localeCompare(a.showDate!))) {
    const tracks = new Map((job.tracks ?? []).map((t) => [t.key, t]));
    const lines = new Map((job.lines ?? []).map((l) => [l.id, l]));
    const entries = (await ctx.db.query("researchEntries").withIndex("by_jobId_key", (q) => q.eq("jobId", job.jobId)).collect())
      .filter((e) => !e.stale && !e.edited);
    for (const e of entries) {
      const track = tracks.get(job.kind === "verify" ? (lines.get(e.key)?.trackKey ?? "") : e.key);
      if (track?.closing) continue;
      // A block Tarik or the agent marked private, or one on an embargoed track, is counted, never named (R12).
      const held = !!e.private || (!!track && !!trackEmbargo(track, active));
      const hour = /^H(\d)\.threads$/.exec(e.key)?.[1];
      for (const c of e.claims) {
        if (c.status !== "conflict" && c.status !== "could-not-verify") continue;
        if (held) {
          openClaimsPrivate += 1;
          continue;
        }
        const label = track ? `${track.artist} · ${KIND_WORDS[c.kind]}` : hour ? `Hour ${hour} thread` : `${e.key} · ${KIND_WORDS[c.kind]}`;
        openClaims.push({ jobId: job.jobId, label, status: c.status });
      }
    }
  }
  return { openClaims, openClaimsPrivate };
}

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

    const now = Date.now();
    const { openClaims, openClaimsPrivate } = await openClaimsOf(ctx, ws, chicagoDayKey(now));
    const cutoff = digestCutoff(now);
    // Plan 8: new records received since the cutoff. An embargoed one is counted, never named: no title, label or row
    // of it reaches the digest (job 9 sends counts and labels to Telegram).
    const fresh = (await ctx.db.query("releases").withIndex("by_workspace", (q) => q.eq("workspace", ws)).collect())
      .filter((r) => statusOf(r) === "new" && (r.receivedAt ?? 0) >= cutoff)
      .sort((a, b) => b.receivedAt! - a.receivedAt!);
    const today = chicagoDayKey(now);
    const shown = fresh.filter((r) => !isEmbargoActive(r.embargo, today));
    // The card and its labels are the Bandcamp tab's; co-signs are counted, per tab, like embargoed records.
    const bandcamp = shown.filter((r) => (r.source ?? "bandcamp") === "bandcamp");
    const labels = [...new Set(bandcamp.map((r) => r.label).filter((l): l is string => !!l))];
    const byTab = { bandcamp: 0, cosign: 0 };
    const embargoed = { bandcamp: 0, cosign: 0 };
    for (const r of fresh) {
      byTab[r.source ?? "bandcamp"] += 1;
      if (isEmbargoActive(r.embargo, today)) embargoed[r.source ?? "bandcamp"] += 1;
    }

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
      openClaimsPrivate,
      releases: {
        count: fresh.length,
        labels,
        // Only what the card shows: never senders, links, players or edit marks.
        items: bandcamp.slice(0, 2).map((r) => ({ artist: r.artist, title: r.title, ...(r.label && { label: r.label }), ...(r.type && { type: r.type }), tab: r.source ?? ("bandcamp" as const) })),
        embargoed,
        byTab,
      },
      blockedSince: blocked.length,
      blockedLatest: latest ? { title: latest.title, destination: latest.destination } : undefined,
    };
  },
});
