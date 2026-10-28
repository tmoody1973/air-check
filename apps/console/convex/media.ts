import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sameToken } from "./agentSubmit";
import { actorOf, gateFor, viaGate, workspaceOf } from "./gate";
import { convexPackageStore } from "./packageStore";

// The media service on the VM (joins the two hour WAVs into the MP3) is the only caller. Every function checks
// MEDIA_TOKEN first, in constant time, and fails closed when it is unset or shorter than 32 characters.
// One secret for two services would let either act as the other, so equal tokens refuse everything (M7, Plan 6).
function requireMedia(token: string): void {
  const { MEDIA_TOKEN, PUBLISHER_TOKEN, INGEST_TOKEN } = process.env;
  if (MEDIA_TOKEN === PUBLISHER_TOKEN || MEDIA_TOKEN === INGEST_TOKEN || !sameToken(token, MEDIA_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

/** Real packages waiting for their MP3. */
export const pending = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireMedia(token);
    const docs = await ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", "preparing_audio")).collect();
    return docs.map((d) => ({ packageId: d.packageId, showDate: d.draft.showDate as string }));
  },
});

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * The MP3 is ready. R3: the agent's hour ids are placeholders and never trusted, so the WAV filenames the media
 * service actually joined replace them, then the gate attaches the MP3 hash. One mutation, so both or neither happen.
 */
export const attached = mutation({
  args: {
    token: v.string(), packageId: v.string(), hour1Id: v.string(), hour2Id: v.string(),
    mp3Sha256: v.string(), hour1DurationSec: v.number(), mp3Bytes: v.number(),
  },
  handler: async (ctx, { token, packageId, hour1Id, hour2Id, mp3Sha256, hour1DurationSec, mp3Bytes }) => {
    requireMedia(token);
    if (!SHA256.test(mp3Sha256) || !hour1Id || !hour2Id || !(hour1DurationSec > 0) || !(mp3Bytes > 0))
      throw new ConvexError({ code: "BAD_INPUT" });
    const store = convexPackageStore(ctx);
    const cur = await store.get(packageId);
    if (!cur) throw new ConvexError({ code: "NOT_FOUND" });
    if (cur.draft.workspace !== "real" || cur.status !== "preparing_audio") throw new ConvexError({ code: "NOT_READY" });
    const draft = { ...cur.draft, audio: { hour1Id, hour2Id } };
    if (!(await store.compareAndSwap(packageId, { status: "preparing_audio" }, { draft }))) throw new ConvexError({ code: "NOT_READY" });
    return viaGate(() => gateFor(ctx).attachAudio(packageId, { hour1Id, hour2Id, mp3Sha256, hour1DurationSec, mp3Bytes }));
  },
});

/** Shows whose audio is not ready, and why. Replaces the whole set, so a fixed problem disappears. */
export const waiting = mutation({
  args: { token: v.string(), items: v.array(v.object({ showDate: v.string(), reason: v.string() })) },
  handler: async (ctx, { token, items }) => {
    requireMedia(token);
    // Every pass sends the set; an unchanged one writes nothing (M8).
    const key = (xs: { showDate: string; reason: string }[]) => JSON.stringify(xs.map((x) => [x.showDate, x.reason]).sort());
    if (key(await ctx.db.query("audioIssues").collect()) === key(items)) return;
    for (const row of await ctx.db.query("audioIssues").collect()) await ctx.db.delete(row._id);
    const updatedAt = Date.now();
    for (const item of items) await ctx.db.insert("audioIssues", { ...item, updatedAt });
  },
});

/** Packages whose prepared MP3 can be deleted: skipped, or already on Mixcloud. */
export const cleanup = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireMedia(token);
    const byStatus = (status: "skipped" | "succeeded") =>
      ctx.db.query("packages").withIndex("by_workspace_status", (q) => q.eq("workspace", "real").eq("status", status)).collect();
    return (await Promise.all([byStatus("skipped"), byStatus("succeeded")])).flat().map((d) => d.packageId);
  },
});

/**
 * I2: the status of each real package asked about (the prepared MP3s on disk), so media can say which shows hold
 * the prepared slots. Read only; demo and unknown ids are left out.
 */
export const statuses = query({
  args: { token: v.string(), packageIds: v.array(v.string()) },
  handler: async (ctx, { token, packageIds }) => {
    requireMedia(token);
    const out: { packageId: string; status: string }[] = [];
    for (const packageId of packageIds.slice(0, 50)) {
      const d = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", packageId)).unique();
      if (d?.workspace === "real") out.push({ packageId, status: d.status });
    }
    return out;
  },
});

/** R5: the current audio problems for Today, oldest show first. A signed-in real human only; anyone else sees none. */
export const issues = query({
  args: {},
  handler: async (ctx) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return [];
    const rows = await ctx.db.query("audioIssues").collect();
    return rows.map(({ showDate, reason }) => ({ showDate, reason })).sort((a, b) => a.showDate.localeCompare(b.showDate));
  },
});
