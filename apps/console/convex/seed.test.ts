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
    expect(first).toEqual({ packages: 2, activity: 9, verifications: 2, releases: 2, runs: 1 });
  });

  test("seedDemo never touches real rows", async () => {
    const t = convexTest(schema, modules);
    const real = await t.run(async (ctx) => {
      await ctx.db.insert("packages", { packageId: "real-1", workspace: "real", status: "awaiting_review", draft: { id: "real-1" } });
      await ctx.db.insert("activity", { workspace: "real", at: 1, kind: "action", result: "done", title: "real" });
      await ctx.db.insert("verifications", { workspace: "real", claim: "real", status: "conflict" });
      await ctx.db.insert("releases", { workspace: "real", artist: "A", title: "T" });
      await ctx.db.insert("runs", { workspace: "real", runId: "real-run", title: "r", state: {}, updatedAt: 1 });
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
});
