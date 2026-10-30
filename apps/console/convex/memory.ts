import { query } from "./_generated/server";
import { actorOf, workspaceOf } from "./gate";

// Oct 30: the Skills and memory page's "What Air Check learned from you": Tarik's own fixes, passes and edits, read
// from where they already live. Read only, newest first, a few of each. Nothing here is written by the agent.

const SHOWN = 8;
// ponytail: scans the newest rows of each table; they hold hundreds at most. Add indexes if a list ever grows past that.
const SCAN = 400;

const fixedParts = (c: { tracklistText?: string; drive?: string; paper?: string; box?: string; hours?: unknown; folderDate?: true }) =>
  [c.tracklistText !== undefined && "tracklist", c.drive && "Drive doc", c.paper && "Paper notes", c.box && "Box folder", c.hours && "hour files", c.folderDate && "folder date"].filter(
    (x): x is string => typeof x === "string",
  );

export const learned = query({
  args: {},
  handler: async (ctx) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    // Per-show fixes (Plan 6b) are station data: the demo has none.
    const corrections = ws === "real" ? await ctx.db.query("corrections").order("desc").take(SCAN) : [];
    const fixes = corrections
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SHOWN)
      .map((c) => ({ showDate: c.showDate, parts: fixedParts(c), at: c.updatedAt }));

    const releases = await ctx.db.query("releases").withIndex("by_workspace", (q) => q.eq("workspace", ws)).order("desc").take(SCAN);
    const passed = releases.filter((r) => r.status === "passed" && r.passReason).sort((a, b) => (b.statusAt ?? 0) - (a.statusAt ?? 0));
    const passes = passed.slice(0, SHOWN).map((r) => ({ artist: r.artist, title: r.title, reason: r.passReason!, at: r.statusAt ?? r._creationTime }));
    const editedReleases = releases.filter((r) => (r.editedFields ?? []).length > 0);
    const releaseEdits = editedReleases.slice(0, SHOWN).map((r) => ({ artist: r.artist, title: r.title, fields: r.editedFields! }));

    const jobs = await ctx.db.query("research").withIndex("by_workspace_created", (q) => q.eq("workspace", ws)).order("desc").take(30);
    const researchEdits: { label: string; key: string; at: number }[] = [];
    for (const j of jobs) {
      const rows = await ctx.db.query("researchEntries").withIndex("by_jobId_key", (q) => q.eq("jobId", j.jobId)).collect();
      const label = j.kind === "deep-dive" ? `Deep dive: ${j.subject?.name ?? ""}` : `${j.kind === "verify" ? "Pre-air verify" : "Show notes"}${j.showDate ? `, ${j.showDate}` : ""}`;
      for (const e of rows) if (e.edited) researchEdits.push({ label, key: e.key, at: e.edited.at });
    }
    researchEdits.sort((a, b) => b.at - a.at);

    return {
      counts: { fixes: corrections.length, passes: passed.length, releaseEdits: editedReleases.length, researchEdits: researchEdits.length },
      fixes,
      passes,
      releaseEdits,
      researchEdits: researchEdits.slice(0, SHOWN),
    };
  },
});
