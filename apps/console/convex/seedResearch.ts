import { chicagoDayKey, type JudgedClaim } from "@aircheck/core";
import type { MutationCtx } from "./_generated/server";

// Plan 7, ruling P12: the demo's sample research (show notes, a pre-air check and a deep dive), built from the
// fixtures/show-notes-sample.md placeholders. Sample Honesty Rule: bracketed names, example.org sources, no run (so every
// screen labels it Sample, not Live). H1.2 is "[Artist] – [Release title]", the demo's own undated embargoed co-sign, so
// the sample shows the Private and "Embargoed · date not known" marks. Task 6.6 replaces it with a recorded run.

const WS = "demo" as const;
export const SAMPLE_JOB_PREFIX = "rj-sample-";
const TTL_MS = 24 * 3_600_000;

const src = (path: string, primary = false, says?: string): JudgedClaim["sources"][number] => ({
  url: `https://example.org/${path}`, host: "example.org", title: `[Page ${path}]`, via: "tavily", primary, matched: true, ...(says && { says }),
});
const claim = (c: Omit<JudgedClaim, "sources"> & { sources: ReturnType<typeof src>[] }): JudgedClaim => c;

const track = (key: string, artist: string, title: string, closing = false) => {
  const [h, p] = key.slice(1).split(".").map(Number);
  return { key, hour: h as 1 | 2, position: p!, artist, title, closing };
};
const TRACKS = [
  track("H1.1", "[Artist A]", "[Title A]"),
  track("H1.2", "[Artist]", "[Release title]"),
  track("H1.3", "[Artist C]", "[Title C]", true),
  track("H2.1", "[Artist D]", "[Title D]"),
  track("H2.2", "[Artist E]", "[Title E]", true),
];

type Row = { key: string; block: "track" | "intro" | "threads" | "line" | "brief"; claims: JudgedClaim[]; intro?: string; angle?: string; note?: string; replacement?: string; suppliedNote?: string };

const NOTES: Row[] = [
  { key: "H1.intro", block: "intro", claims: [], intro: "The hour moves from [Artist A]'s new single into older label cuts." },
  { key: "H1.threads", block: "threads", claims: [claim({ kind: "thread", text: "[Artist A] and [Artist C] both recorded at [Studio].", status: "sourced", sources: [src("studio")] })] },
  {
    key: "H1.1", block: "track",
    claims: [
      claim({ kind: "label", text: "[Title A] is on [Label A].", value: "[Label A]", status: "confirmed", sources: [src("a1", true), src("a2")] }),
      claim({ kind: "release-date", text: "[Title A] came out on 2026-10-16.", value: "2026-10-16", status: "confirmed", sources: [src("a1", true), src("a2")] }),
      claim({ kind: "detail", text: "[Artist A] co-produced the track with [Producer].", status: "sourced", sources: [src("a2")] }),
      claim({ kind: "bio", text: "[Artist A] is a bassist from [City].", status: "sourced", sources: [src("a3")] }),
    ],
    angle: "What does [Producer] bring to the low end here?",
    suppliedNote: "[Label A]'s one-sheet calls it a late-night record.",
  },
  {
    key: "H1.2", block: "track",
    claims: [claim({
      kind: "release-date", text: "[Release title] came out on 2026-10-10.", value: "2026-10-10", status: "conflict",
      sources: [src("b1", false, "2026-10-10"), src("b2", false, "2026-10-17")],
      check: "Sources disagree: 2026-10-10 (example.org) vs 2026-10-17 (example.org)",
    })],
  },
  { key: "H2.intro", block: "intro", claims: [], intro: "The second hour slows down around [Artist D]." },
  {
    key: "H2.1", block: "track",
    claims: [
      claim({ kind: "detail", text: "[Artist D] recorded it live in one take.", status: "sourced", sources: [src("d2")] }),
      claim({ kind: "label", text: "It came out on [Label D].", value: "[Label D]", status: "could-not-verify", sources: [src("d1")], check: "Only one source: example.org" }),
    ],
    angle: "Which earlier [Label D] record sets this one up?",
  },
];

const LINES = [
  { id: "L1", text: "## 1. [Artist A] – \"[Title A]\"", trackKey: "H1.1", closing: false },
  { id: "L2", text: "Out Oct 9 on [Label A].", trackKey: "H1.1", closing: false },
  { id: "L3", text: "## 2. [Artist] – \"[Release title]\"", trackKey: "H1.2", closing: false },
  { id: "L4", text: "Released Oct 10.", trackKey: "H1.2", closing: false },
  { id: "L5", text: "## 3. [Artist C] – \"[Title C]\"", trackKey: "H1.3", closing: true },
  { id: "L6", text: "## 1. [Artist D] – \"[Title D]\"", trackKey: "H2.1", closing: false },
  { id: "L7", text: "On [Label D].", trackKey: "H2.1", closing: false },
];
const CHECK: Row[] = [
  {
    key: "L2", block: "line", replacement: "Out Oct 16 on [Label A].",
    claims: [claim({ kind: "release-date", text: "[Title A] came out on 2026-10-16.", value: "2026-10-16", status: "confirmed", sources: [src("a1", true), src("a2")] })],
  },
  {
    key: "L4", block: "line",
    claims: [claim({ kind: "release-date", text: "Released Oct 10.", value: "2026-10-10", status: "conflict", sources: [src("b1", false, "2026-10-10"), src("b2", false, "2026-10-17")], check: "Sources disagree: 2026-10-10 (example.org) vs 2026-10-17 (example.org)" })],
  },
  { key: "L7", block: "line", claims: [claim({ kind: "label", text: "On [Label D].", value: "[Label D]", status: "could-not-verify", sources: [src("d1")], check: "Only one source: example.org" })] },
];
const DIVE: Row[] = [{
  key: "brief", block: "brief",
  claims: [
    claim({ kind: "bio", text: "[Artist A] is a bassist from [City].", status: "sourced", sources: [src("a3")] }),
    claim({ kind: "detail", text: "[Artist A] co-produced [Title A] with [Producer].", status: "sourced", sources: [src("a2")] }),
    claim({ kind: "label", text: "[Artist A] has released on [Label A] since [Year].", value: "[Label A]", status: "confirmed", sources: [src("a1", true), src("a4")] }),
    claim({ kind: "detail", text: "[Artist A] toured with [Band] in [Year].", status: "sourced", sources: [src("a5")] }),
    claim({ kind: "detail", text: "[Artist A] scored a short film, [Film].", status: "sourced", sources: [src("a6")] }),
    claim({ kind: "connection", text: "[Artist D] and [Artist A] share a producer, [Producer].", value: "H2.1", status: "sourced", sources: [src("a2")] }),
    claim({ kind: "credit", text: "[Artist A] played on [Album X].", status: "could-not-verify", sources: [src("x1")], check: "Only one source: example.org" }),
  ],
  note: "Two of the interviews come from the same tour.",
}];

/** Inserts the three sample jobs, dated today in Milwaukee so Today's 14-day open-claims window always holds them. */
export async function seedSampleResearch(ctx: MutationCtx, now: number) {
  const showDate = chicagoDayKey(now);
  const jobs = [
    { jobId: `${SAMPLE_JOB_PREFIX}notes`, kind: "show-notes" as const, angles: true, rows: NOTES, at: now - 3_000 },
    { jobId: `${SAMPLE_JOB_PREFIX}check`, kind: "verify" as const, angles: false, rows: CHECK, at: now - 2_000, lines: LINES, notesSource: "pasted" as const },
    { jobId: `${SAMPLE_JOB_PREFIX}dive`, kind: "deep-dive" as const, angles: false, rows: DIVE, at: now - 1_000, subject: { type: "artist" as const, name: "[Artist A]" } },
  ];
  for (const { rows, at, ...j } of jobs) {
    await ctx.db.insert("research", { workspace: WS, ...j, showDate, tracks: TRACKS, status: "done", runIds: [], continuations: 0, createdAt: at, updatedAt: at, finishedAt: at });
    for (const r of rows) await ctx.db.insert("researchEntries", { workspace: WS, jobId: j.jobId, ...r, savedAt: at, updatedAt: at });
  }
}

/** Deletes the sample jobs and visitors' demo jobs older than 24 hours (never a queued or running one), with their entries. */
export async function clearDemoResearch(ctx: MutationCtx, now: number) {
  for (const j of await ctx.db.query("research").withIndex("by_workspace_created", (q) => q.eq("workspace", WS)).collect()) {
    const sample = j.jobId.startsWith(SAMPLE_JOB_PREFIX);
    const stale = now - j.createdAt > TTL_MS && j.status !== "queued" && j.status !== "running";
    if (!sample && !stale) continue;
    for (const e of await ctx.db.query("researchEntries").withIndex("by_jobId_key", (q) => q.eq("jobId", j.jobId)).collect()) await ctx.db.delete(e._id);
    await ctx.db.delete(j._id);
  }
}
