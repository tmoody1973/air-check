import { type PackageDraft, applyRunEvent, fingerprint, initialRun, type RunState } from "@aircheck/core";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { stripUndefined } from "./packageStore";
import { searchTextOf } from "./radar";
import { createdAtOf, statusOf } from "./runDefaults";
import { clearDemoResearch, seedSampleResearch } from "./seedResearch";
import {
  DEMO_MP3_SHA256,
  GOLDEN_ALTERNATES,
  GOLDEN_DESCRIPTION,
  GOLDEN_TAGS,
  GOLDEN_TITLE,
  GOLDEN_TRACKS,
} from "./seedData";

const WS = "demo" as const;
/**
 * Tables written only by this seed in the demo workspace: wiped and re-inserted on every run. `verifications` is no
 * longer seeded (Plan 7 Task 5: nothing reads it); the wipe empties the old demo rows before Task 6 drops the table.
 */
const SEED_ONLY = ["verifications", "releases"] as const;
const SEEDED_PACKAGES = new Set(["demo-10-2-26", "demo-long-title"]);
const SEEDED_RUN = "demo-run-1";
/** Visitors' demo rows (chats, runs, packages, activity) are kept this long. */
const USER_ROW_TTL_MS = 24 * 3_600_000;
const IN_FLIGHT = new Set(["queued", "running", "stopping"]);

const goldenDemo: PackageDraft = {
  id: "demo-10-2-26",
  workspace: WS,
  showDate: "2026-10-02",
  title: GOLDEN_TITLE,
  tags: GOLDEN_TAGS,
  description: GOLDEN_DESCRIPTION,
  tracks: GOLDEN_TRACKS,
  audio: { hour1Id: "demo-hour-1", hour2Id: "demo-hour-2", mp3Sha256: DEMO_MP3_SHA256, hour1DurationSec: 10 },
  flags: [
    "Spellings taken from your Paper notes (Lý Qua Dub, Quiñones, Gutiérrez).",
    "Left out: the pre-air verify list and one personal detail.",
  ],
  alternates: GOLDEN_ALTERNATES,
};

/** 99 characters, exactly 5 tags: the 375px layout test (Task 14) needs a title that wraps. */
export const LONG_TITLE =
  "RLR 10.2.26 | Michael Kiwanuka, Tinashe, Bicep, GENA, Hiatus Kaiyote, Logic1000, Seun Kuti and more";

const longTitleDemo: PackageDraft = {
  ...goldenDemo,
  id: "demo-long-title",
  title: LONG_TITLE,
  flags: undefined,
  alternates: undefined,
};

// The nine rows of the Trust mock, newest first: [seconds before the newest, row].
const ACTIVITY = [
  [0, { kind: "waiting", result: "needs_you", title: "RLR 10.2.26 ready for your approval · 2 flags", packageId: "demo-10-2-26" }],
  [15, { kind: "network", result: "blocked", title: "Agent ran curl", destination: "example.com", reason: "Not on the allow-list" }],
  [29, { kind: "action", result: "done", title: "Drafted the Mixcloud package (title, 5 tags, description)" }],
  [59, { kind: "network", result: "allowed", title: "Model call (Nemotron 3 Super)", destination: "Nebius Token Factory" }],
  [77, { kind: "network", result: "blocked", title: "Hermes contacted its maker", destination: "portal.nousresearch.com", reason: "Not on the allow-list" }],
  [90, { kind: "action", result: "done", title: "Updated skill: title style (you shortened a title)" }],
  [128, { kind: "network", result: "allowed", title: "Web search for release dates (source_search)", destination: "Air Check bridge" }],
  [150, { kind: "network", result: "allowed", title: "Checked for new Telegram messages", destination: "api.telegram.org" }],
  [298, { kind: "action", result: "done", title: "Fact-checked 31 tracks (2 open claims)" }],
] as const;

type Row = { label: string; text: string; sources?: string[] };
const DONE: Row[] = [
  { label: "H1.4", text: "Resavoir – “4th Cloud” feat. Gregory Uhlmann", sources: ["musicbrainz.org", "bandcamp.com", "tavily · 2 sources"] },
  { label: "H1.5", text: "Michael Kiwanuka – “Summer Clothes”", sources: ["musicbrainz.org", "discogs.com", "[verify] release date: sources disagree"] },
];
const WORKING: Row = { label: "H1.6", text: "The Midnight Hour – “Water’s Edge”", sources: ["checking label on Discogs…"] };

function demoRunState(now: number): RunState {
  const rows = [...DONE, WORKING];
  let s = initialRun("demo-run-1");
  rows.forEach((r, i) => {
    const at = now - (rows.length - i) * 20_000;
    s = applyRunEvent(s, "tool.started", { tool: "web_search", preview: r.text }, at);
    if (r !== WORKING) s = applyRunEvent(s, "tool.completed", { tool: "web_search", duration: 12 }, at + 12_000);
  });
  return { ...s, steps: s.steps.map((st, i) => ({ ...st, label: rows[i]!.label, sources: rows[i]!.sources })) };
}

// Task 6b: Bandcamp rows get bracketed tags and an about, never cover art (copyrighted: the page shows a placeholder).
const SAMPLE_PAGE = { tags: ["[tag]", "[another tag]"], about: "[The album's description from its Bandcamp page]" };
const SAMPLE_RELEASES = [
  { source: "bandcamp", status: "new", type: "album", favorite: true, ...SAMPLE_PAGE },
  { source: "bandcamp", status: "considering", type: "single", ...SAMPLE_PAGE },
  { source: "cosign", status: "new", type: "single", embargo: { until: null } },
  { source: "cosign", status: "passed", type: "ep", passReason: "[Reason]" },
] as const;

const SEEDED_ACTIVITY_TITLES = new Set<string>(ACTIVITY.map(([, row]) => row.title));

/**
 * Deletes the seeded demo rows and visitors' demo rows older than 24 hours. A run that is queued,
 * running or stopping is never deleted, and a conversation is kept while any of its runs is kept,
 * so a reseed never cuts off live work or resets the daily live-run count.
 */
async function clearDemo(ctx: MutationCtx, now: number) {
  const stale = (at: number) => now - at > USER_ROW_TTL_MS;
  for (const table of SEED_ONLY) {
    for (const r of await ctx.db.query(table).filter((q) => q.eq(q.field("workspace"), WS)).collect()) await ctx.db.delete(r._id);
  }
  for (const p of await ctx.db.query("packages").filter((q) => q.eq(q.field("workspace"), WS)).collect()) if (SEEDED_PACKAGES.has(p.packageId) || stale(p._creationTime)) await ctx.db.delete(p._id);
  for (const a of await ctx.db.query("activity").filter((q) => q.eq(q.field("workspace"), WS)).collect()) if ((!a.key && SEEDED_ACTIVITY_TITLES.has(a.title)) || stale(a.at)) await ctx.db.delete(a._id);

  const keptConversations = new Set<string>();
  for (const r of await ctx.db.query("runs").filter((q) => q.eq(q.field("workspace"), WS)).collect()) {
    const keep = r.runId !== SEEDED_RUN && (IN_FLIGHT.has(statusOf(r) ?? "") || !stale(createdAtOf(r)));
    if (!keep) await ctx.db.delete(r._id);
    else if (r.conversationId) keptConversations.add(r.conversationId);
  }
  const dropped = new Set<Id<"conversations">>();
  for (const c of await ctx.db.query("conversations").filter((q) => q.eq(q.field("workspace"), WS)).collect()) {
    if (keptConversations.has(c._id) || !stale(c.createdAt)) continue;
    dropped.add(c._id);
    await ctx.db.delete(c._id);
  }
  // Every message has a run created with it, so a message younger than 24 h keeps its conversation.
  for (const m of await ctx.db.query("messages").filter((q) => q.eq(q.field("workspace"), WS)).collect()) if (dropped.has(m.conversationId)) await ctx.db.delete(m._id);
  await clearDemoResearch(ctx, now);
}

/** Refreshes the demo workspace (see clearDemo). Never reads, changes or deletes a "real" row. */
export const seedDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    await clearDemo(ctx, now);

    for (const draft of [goldenDemo, longTitleDemo]) {
      const clean = stripUndefined(draft);
      await ctx.db.insert("packages", {
        packageId: draft.id,
        workspace: WS,
        status: "awaiting_review",
        draft: clean,
        fingerprint: await fingerprint(draft),
      });
    }

    const newest = now - 60_000;
    for (const [secondsBefore, row] of ACTIVITY) await ctx.db.insert("activity", { workspace: WS, at: newest - secondsBefore * 1000, ...row });

    // Sample Honesty Rule (DESIGN.md): bracketed placeholders, never invented releases. Both radar tabs, one undated
    // embargo, and no players or links: no real music in the demo or the video (Plan 8, Hard Rule 9).
    for (const [i, row] of SAMPLE_RELEASES.entries()) {
      const at = newest - i * 60_000;
      // A co-sign shows its sender prominently: a bracketed sample one, never a real address.
      const sender = row.source === "cosign" ? { senders: [{ name: "[Label or PR company]", messageId: `demo-sample-${i}`, at }] } : {};
      const fields = { artist: "[Artist]", title: "[Release title]", label: "[Label]", ...row, ...("tags" in row && { tags: [...row.tags] }) };
      await ctx.db.insert("releases", { workspace: WS, receivedAt: at, ...sender, ...fields, searchText: searchTextOf(fields) });
    }

    await seedSampleResearch(ctx, now);

    await ctx.db.insert("runs", {
      workspace: WS,
      runId: "demo-run-1",
      title: "Writing show notes · Hour 1",
      state: stripUndefined(demoRunState(now)),
      upcoming: [
        { label: "H1.7", text: "Elliott Skinner – “Don’t Be A Runner”", status: "next" },
        { label: "H1.15", text: "Channell & 2bfrank – “Just Move” · closing track, no notes", status: "skipped" },
      ],
      updatedAt: now,
      kind: "draft-package",
      source: "scripted",
      status: "completed",
      input: "",
      stopRequested: false,
      createdAt: now,
    });
  },
});
