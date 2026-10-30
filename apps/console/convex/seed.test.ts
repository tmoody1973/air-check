// @vitest-environment edge-runtime
import { fingerprint } from "@aircheck/core";
import { convexTest } from "convex-test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { goldenPackageTitles } from "../../../packages/core/test/helpers/fixtures";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DEMO_MP3_SHA256, GOLDEN_ALTERNATES, GOLDEN_DESCRIPTION, GOLDEN_TAGS, GOLDEN_TITLE, GOLDEN_TRACKS } from "./seedData";

const modules = import.meta.glob("./**/*.*s");
const demoUser = { subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo" };
const TABLES = ["packages", "activity", "verifications", "releases", "runs"] as const;

const counts = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => Object.fromEntries(await Promise.all(TABLES.map(async (n) => [n, (await ctx.db.query(n).collect()).length]))));

describe("seedDemo", () => {
  test("seedDemo is idempotent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const first = await counts(t);
    await t.mutation(internal.seed.seedDemo, {});
    expect(await counts(t)).toEqual(first);
    // Plan 7 Task 5: nothing reads `verifications` any more (Today counts open claims from research), so it is not seeded;
    // the wipe still empties old demo rows until Task 6 drops the table.
    expect(first).toEqual({ packages: 2, activity: 9, verifications: 0, releases: 4, runs: 1 });
    // Web search goes through Air Check's bridge (decision 006), never straight to Tavily from the sandbox.
    const activity = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity.map((a) => a.destination ?? "")).not.toContain("api.tavily.com");
  });

  test("demo releases: both tabs, a status and a source each, bracketed values, one undated embargo, no players", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const rows = await t.run((ctx) => ctx.db.query("releases").collect());
    expect(rows.every((r) => r.workspace === "demo")).toBe(true);
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(["bandcamp", "cosign"]));
    for (const r of rows) {
      expect(r.status).toBeTruthy();
      expect(r.receivedAt).toBeTypeOf("number");
      for (const v of [r.artist, r.title, r.label]) expect(v).toMatch(/^\[.+\]$/);
      expect(r).not.toHaveProperty("embed");
      expect(r).not.toHaveProperty("bandcampPage");
      expect(r).not.toHaveProperty("embedState");
      expect(r).not.toHaveProperty("links");
    }
    expect(rows.filter((r) => r.embargo).map((r) => r.embargo)).toEqual([{ until: null }]);
    // Task 6b: bracketed tags and about on Bandcamp rows, never cover art (copyrighted: the video rule); one favorite;
    // every row searchable.
    for (const r of rows) {
      expect(r).not.toHaveProperty("art");
      expect(r.searchText).toBeTruthy();
    }
    for (const r of rows.filter((x) => x.source === "bandcamp")) {
      expect(r.tags?.length).toBeGreaterThan(0);
      for (const v of [...r.tags!, r.about]) expect(v).toMatch(/^\[.+\]$/);
    }
    expect(rows.filter((r) => r.favorite)).toHaveLength(1);
    // Co-signs show their sender prominently: a bracketed sample one, never a real address.
    for (const r of rows.filter((x) => x.source === "cosign")) expect(r.senders?.map((s) => [s.name, s.address])).toEqual([["[Label or PR company]", undefined]]);
    // The demo has no inbox (Hard Rule 9: inbound mail writes the real workspace only).
    expect(await t.run((ctx) => ctx.db.query("inbox").collect())).toEqual([]);
  });

  test("an old demo verifications row is wiped and none is written back", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("verifications", { workspace: "demo", claim: "old", status: "conflict" }));
    await t.mutation(internal.seed.seedDemo, {});
    expect(await t.run((ctx) => ctx.db.query("verifications").collect())).toEqual([]);
  });

  test("seedDemo never touches real rows", async () => {
    const t = convexTest(schema, modules);
    const real = await t.run(async (ctx) => {
      await ctx.db.insert("packages", { packageId: "real-1", workspace: "real", status: "awaiting_review", draft: { id: "real-1" } });
      await ctx.db.insert("activity", { workspace: "real", at: 1, kind: "action", result: "done", title: "real" });
      await ctx.db.insert("verifications", { workspace: "real", claim: "real", status: "conflict" });
      await ctx.db.insert("releases", { workspace: "real", artist: "A", title: "T" });
      await ctx.db.insert("runs", { workspace: "real", runId: "real-run", title: "r", state: {}, updatedAt: 1, kind: "chat", source: "live", status: "completed", input: "", stopRequested: false, createdAt: 1 });
      return Promise.all(TABLES.map((n) => ctx.db.query(n).collect()));
    });
    await t.mutation(internal.seed.seedDemo, {});
    await t.mutation(internal.seed.seedDemo, {});
    const after = await t.run((ctx) => Promise.all(TABLES.map(async (n) => (await ctx.db.query(n).collect()).filter((r) => r.workspace === "real"))));
    expect(after).toEqual(real);
  });

  test("the demo login can approve the seeded golden package with its seeded fingerprint", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const as = t.withIdentity(demoUser);
    const rec = await as.query(api.packages.get, { packageId: "demo-10-2-26" });
    expect(rec?.status).toBe("awaiting_review");
    expect(rec?.fingerprint).toBe(await fingerprint(rec!.draft));
    const r = await as.mutation(api.packages.decide, { packageId: "demo-10-2-26", fingerprint: rec!.fingerprint!, decision: "approve" });
    expect(r.ok).toBe(true);
  });

  test("seed values equal the golden fixture helper (no drift)", () => {
    const g = goldenDraft();
    expect(GOLDEN_TITLE).toBe(g.title);
    expect(GOLDEN_TAGS).toEqual(g.tags);
    expect(GOLDEN_DESCRIPTION).toBe(g.description);
    expect(GOLDEN_TRACKS).toEqual(g.tracks);
    expect(GOLDEN_ALTERNATES).toEqual(goldenPackageTitles().slice(1));
    expect(GOLDEN_TRACKS).toHaveLength(31);
  });

  const HOUR = 3_600_000;
  const userRun = (runId: string, createdAt: number, status: "running" | "completed" | "queued", conversationId?: string) => ({
    workspace: "demo" as const, runId, title: "Chat", state: {}, updatedAt: createdAt, kind: "chat" as const, source: "live" as const,
    status, input: "hi", stopRequested: false, createdAt, conversationId, sessionKey: "s1",
  });

  test("a reseed leaves a 1-hour-old live demo run and its conversation intact (daily cap count unchanged)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const now = Date.now();
    const convId = await t.run(async (ctx) => {
      const c = await ctx.db.insert("conversations", { workspace: "demo", title: "hi", createdAt: now - HOUR });
      await ctx.db.insert("messages", { workspace: "demo", conversationId: c, role: "user", text: "hi", at: now - HOUR });
      await ctx.db.insert("runs", userRun("live-1h", now - HOUR, "completed", c));
      return c;
    });
    const liveToday = () => t.run(async (ctx) => (await ctx.db.query("runs").withIndex("by_workspace_source_created", (q) => q.eq("workspace", "demo").eq("source", "live")).collect()).length);
    const before = await liveToday();
    await t.mutation(internal.seed.seedDemo, {});
    expect(await liveToday()).toBe(before);
    const kept = await t.run(async (ctx) => ({
      run: await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", "live-1h")).first(),
      conv: await ctx.db.get(convId),
      msgs: await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", convId)).collect(),
    }));
    expect(kept.run).not.toBeNull();
    expect(kept.conv).not.toBeNull();
    expect(kept.msgs).toHaveLength(1);
  });

  test("a 25-hour-old finished demo run is removed with its conversation; an old in-flight run and its conversation stay", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      const oldConv = await ctx.db.insert("conversations", { workspace: "demo", title: "old", createdAt: now - 25 * HOUR });
      await ctx.db.insert("messages", { workspace: "demo", conversationId: oldConv, role: "user", text: "old", at: now - 25 * HOUR });
      await ctx.db.insert("runs", userRun("old-done", now - 25 * HOUR, "completed", oldConv));
      const liveConv = await ctx.db.insert("conversations", { workspace: "demo", title: "busy", createdAt: now - 25 * HOUR });
      await ctx.db.insert("runs", userRun("old-running", now - 25 * HOUR, "running", liveConv));
      await ctx.db.insert("packages", { packageId: "demo-10-9-26-abcde", workspace: "demo", status: "awaiting_review", draft: { id: "demo-10-9-26-abcde" } });
      return { oldConv, liveConv };
    });
    await t.mutation(internal.seed.seedDemo, {});
    const after = await t.run(async (ctx) => ({
      runs: (await ctx.db.query("runs").collect()).map((r) => r.runId).sort(),
      oldConv: await ctx.db.get(ids.oldConv),
      liveConv: await ctx.db.get(ids.liveConv),
      msgs: (await ctx.db.query("messages").collect()).length,
      pkgs: (await ctx.db.query("packages").collect()).map((p) => p.packageId).sort(),
    }));
    expect(after.runs).toEqual(["demo-run-1", "old-running"]);
    expect(after.oldConv).toBeNull();
    expect(after.liveConv).not.toBeNull();
    expect(after.msgs).toBe(0);
    // A fresh user package (younger than 24 h) survives the reseed.
    expect(after.pkgs).toEqual(["demo-10-2-26", "demo-10-9-26-abcde", "demo-long-title"]);
  });

  test("seeded rows are refreshed: an approved golden package returns to awaiting_review", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    await t.run(async (ctx) => {
      const p = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", "demo-10-2-26")).first();
      await ctx.db.patch(p!._id, { status: "approved" });
    });
    await t.mutation(internal.seed.seedDemo, {});
    const rec = await t.withIdentity(demoUser).query(api.packages.get, { packageId: "demo-10-2-26" });
    expect(rec!.status).toBe("awaiting_review");
    expect((await counts(t)).packages).toBe(2);
  });

  test("demo-long-title has a 99-character title and exactly 5 tags", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const rec = await t.withIdentity(demoUser).query(api.packages.get, { packageId: "demo-long-title" });
    expect([...rec!.draft.title].length).toBe(99);
    expect(rec!.draft.tags).toHaveLength(5);
    expect(rec!.status).toBe("awaiting_review");
  });

  test("the seed hash constant matches public/demo/sample-hour.mp3", () => {
    const mp3 = readFileSync(new URL("../public/demo/sample-hour.mp3", import.meta.url));
    expect(createHash("sha256").update(mp3).digest("hex")).toBe(DEMO_MP3_SHA256);
  });

  test("activity is recent, ordered, and carries the mock's nine rows", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const rows = (await t.run((ctx) => ctx.db.query("activity").collect())).sort((a, b) => b.at - a.at);
    expect(rows.map((r) => r.result)).toEqual(["needs_you", "blocked", "done", "allowed", "blocked", "done", "allowed", "allowed", "done"]);
    expect(Date.now() - rows[rows.length - 1]!.at).toBeLessThan(3_600_000);
  });

  test("demo-run-1 has H1.4 and H1.5 done, H1.6 working, H1.7 next, H1.15 skipped", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const run = await t.withIdentity(demoUser).query(api.runs.get, { runId: "demo-run-1" });
    expect(run!.title).toBe("Writing show notes · Hour 1");
    expect(run!.state.status).toBe("running");
    expect(run!.state.steps.map((s: { label: string; status: string }) => [s.label, s.status])).toEqual([
      ["H1.4", "done"],
      ["H1.5", "done"],
      ["H1.6", "working"],
    ]);
    expect(run!.state.steps[1].sources).toContain("[verify] release date: sources disagree");
    expect(run!.upcoming!.map((u) => [u.label, u.status])).toEqual([["H1.7", "next"], ["H1.15", "skipped"]]);
  });

  test("P12: sample research jobs (Sample: no run, placeholders, example.org only), refreshed on every seed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    await t.mutation(internal.seed.seedDemo, {});
    const jobs = await t.run((ctx) => ctx.db.query("research").collect());
    expect(jobs.map((j) => j.kind).sort()).toEqual(["deep-dive", "show-notes", "verify"]);
    for (const j of jobs) {
      expect(j.workspace).toBe("demo");
      expect(j.status).toBe("done");
      expect(j.runIds).toEqual([]);
    }
    const rows = await t.run((ctx) => ctx.db.query("researchEntries").collect());
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(r.workspace).toBe("demo");
      for (const c of r.claims) for (const s of c.sources) expect(s.host).toBe("example.org");
    }
    // Every artist and title is a bracketed placeholder; closing tracks have no entry.
    const notes = jobs.find((j) => j.kind === "show-notes")!;
    for (const tr of notes.tracks!) for (const v of [tr.artist, tr.title]) expect(v).toMatch(/^\[.+\]$/);
    const closing = new Set(notes.tracks!.filter((tr) => tr.closing).map((tr) => tr.key));
    expect(rows.filter((r) => r.jobId === notes.jobId && closing.has(r.key))).toEqual([]);
    // The sample shows up on the demo's Today (open claims) and its research page.
    const demoUserToday = await t.withIdentity(demoUser).query(api.today.summary, {});
    expect(demoUserToday!.openClaims.length).toBeGreaterThan(0);
    expect(await t.withIdentity(demoUser).query(api.research.get, { jobId: notes.jobId })).not.toBeNull();
  });

  test("P12: visitors' demo research older than 24 h is pruned; active jobs, fresh jobs and real rows stay", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const job = (workspace: "demo" | "real", jobId: string, createdAt: number, status = "done") =>
      ({ workspace, jobId, kind: "deep-dive", subject: { type: "artist", name: "[A]" }, angles: false, status, runIds: ["r"], continuations: 0, createdAt, updatedAt: createdAt }) as never;
    await t.run(async (ctx) => {
      await ctx.db.insert("research", job("demo", "rj-old001", now - 25 * HOUR));
      await ctx.db.insert("researchEntries", { workspace: "demo", jobId: "rj-old001", key: "brief", block: "brief", claims: [], updatedAt: 1 });
      await ctx.db.insert("research", job("demo", "rj-busy01", now - 25 * HOUR, "running"));
      await ctx.db.insert("research", job("demo", "rj-new001", now - HOUR));
      await ctx.db.insert("research", job("real", "rj-real01", now - 99 * HOUR));
      await ctx.db.insert("researchEntries", { workspace: "real", jobId: "rj-real01", key: "brief", block: "brief", claims: [], updatedAt: 1 });
    });
    await t.mutation(internal.seed.seedDemo, {});
    const ids = await t.run(async (ctx) => (await ctx.db.query("research").collect()).map((j) => j.jobId));
    expect(ids).toEqual(expect.arrayContaining(["rj-busy01", "rj-new001", "rj-real01"]));
    expect(ids).not.toContain("rj-old001");
    const entries = await t.run(async (ctx) => (await ctx.db.query("researchEntries").collect()).map((e) => e.jobId));
    expect(entries).not.toContain("rj-old001");
    expect(entries).toContain("rj-real01");
  });
});
