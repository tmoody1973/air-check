import { type PackageDraft, applyRunEvent, fingerprint, initialRun, type RunState } from "@aircheck/core";
import { internalMutation } from "./_generated/server";
import { stripUndefined } from "./packageStore";
import {
  DEMO_MP3_SHA256,
  GOLDEN_ALTERNATES,
  GOLDEN_DESCRIPTION,
  GOLDEN_TAGS,
  GOLDEN_TITLE,
  GOLDEN_TRACKS,
} from "./seedData";

const WS = "demo" as const;
const TABLES = ["packages", "activity", "verifications", "releases", "runs"] as const;

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
const T = (s: number) => s;
const ACTIVITY = [
  [T(0), { kind: "waiting", result: "needs_you", title: "RLR 10.2.26 ready for your approval · 2 flags", packageId: "demo-10-2-26" }],
  [T(15), { kind: "network", result: "blocked", title: "Agent ran curl", destination: "example.com", reason: "Not on the allow-list" }],
  [T(29), { kind: "action", result: "done", title: "Drafted the Mixcloud package (title, 5 tags, description)" }],
  [T(59), { kind: "network", result: "allowed", title: "Model call (Nemotron 3 Super)", destination: "Nebius Token Factory" }],
  [T(77), { kind: "network", result: "blocked", title: "Hermes contacted its maker", destination: "portal.nousresearch.com", reason: "Not on the allow-list" }],
  [T(90), { kind: "action", result: "done", title: "Updated skill: title style (you shortened a title)" }],
  [T(128), { kind: "network", result: "allowed", title: "Web search for release dates", destination: "api.tavily.com" }],
  [T(150), { kind: "network", result: "allowed", title: "Checked for new Telegram messages", destination: "api.telegram.org" }],
  [T(298), { kind: "action", result: "done", title: "Fact-checked 31 tracks (2 open claims)" }],
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

/** Wipes and re-inserts the demo workspace. Never reads, changes or deletes a "real" row. */
export const seedDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of TABLES) {
      const rows = await ctx.db.query(table).filter((q) => q.eq(q.field("workspace"), WS)).collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
    const now = Date.now();

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

    await ctx.db.insert("verifications", { workspace: WS, claim: "ALA.NI release date", status: "conflict" });
    await ctx.db.insert("verifications", { workspace: WS, claim: "Silvan Strauss project credit", status: "could-not-verify", show: "10-2-26" });

    // Sample Honesty Rule (DESIGN.md): bracketed placeholders, never invented releases.
    await ctx.db.insert("releases", { workspace: WS, artist: "[Artist]", title: "[Release title]", label: "[Label]", type: "album" });
    await ctx.db.insert("releases", { workspace: WS, artist: "[Artist]", title: "[Release title]", label: "[Label]", type: "single" });

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
    });
  },
});
