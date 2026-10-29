// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api } from "./_generated/api";
import schema from "./schema";

// Add a 2025 show: the backlog is 2026 by design; Tarik adds the few 2025 Fridays he still has to post, one by one, so
// nothing already on Mixcloud is drafted again. Only a signed-in real human adds or removes one (Hard Rule 9).
const modules = import.meta.glob("./**/*.*s");
const INGEST = "i".repeat(48);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };
const outsider = { subject: "x1", email: "someone@gmail.com", emailVerified: true };
type T = ReturnType<typeof convexTest>;

beforeEach(() => vi.stubEnv("INGEST_TOKEN", INGEST));
afterEach(() => vi.unstubAllEnvs());

const D = "2025-12-26"; // a Friday
const FROZEN = { code: "BAD_INPUT", message: "this show already has a package; change it on the package page" };
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: { code?: string; message?: string } }).data;
    return { code: data?.code ?? String(e), message: data?.message ?? "" };
  }
  return { code: "no error", message: "" };
};
const list = (t: T) => t.query(api.ingest.list, { token: INGEST });
const rows = (t: T) => t.run((ctx) => ctx.db.query("extraDates").collect());
const episode = (showDate: string) => ({
  showDate, audio: { status: "ready" as const, flags: [] }, tracklist: { status: "found" as const }, notes: { status: "missing" as const }, questions: [],
});

describe("access (Hard Rule 9)", () => {
  test("demo, signed-out and outside users get FORBIDDEN and null; nothing is written", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(human).mutation(api.episodes.addShowDate, { date: D });
    for (const as of [t, t.withIdentity(demo), t.withIdentity(outsider)]) {
      expect((await failure(as.mutation(api.episodes.addShowDate, { date: "2025-12-19" }))).code).toBe("FORBIDDEN");
      expect((await failure(as.mutation(api.episodes.removeShowDate, { date: D }))).code).toBe("FORBIDDEN");
      expect(await as.query(api.episodes.extraDates, {})).toBeNull();
    }
    expect((await rows(t)).map((r) => r.date)).toEqual([D]);
  });
});

describe("addShowDate", () => {
  test("only a real 2025 Friday", async () => {
    const h = convexTest(schema, modules).withIdentity(human);
    const year = { code: "BAD_INPUT", message: "the date must be a real 2025 date, yyyy-mm-dd" };
    for (const date of ["2025-02-30", "12-26-25", "", "2026-01-02", "2024-12-27"]) expect(await failure(h.mutation(api.episodes.addShowDate, { date }))).toEqual(year);
    expect(await failure(h.mutation(api.episodes.addShowDate, { date: "2025-12-25" }))).toEqual({ code: "BAD_INPUT", message: "Rhythm Lab airs Fridays — pick a Friday" });
    expect(await h.query(api.episodes.extraDates, {})).toEqual([]);
  });

  test("is idempotent, lists sorted, and goes to the scanner with a rescan", async () => {
    const t = convexTest(schema, modules);
    const h = t.withIdentity(human);
    const before = (await list(t)).rescanAfter;
    await h.mutation(api.episodes.addShowDate, { date: D });
    await h.mutation(api.episodes.addShowDate, { date: "2025-01-03" });
    await h.mutation(api.episodes.addShowDate, { date: D });
    expect(await h.query(api.episodes.extraDates, {})).toEqual(["2025-01-03", D]);
    expect(await rows(t)).toHaveLength(2);
    const after = await list(t);
    expect(after.extraDates).toEqual(["2025-01-03", D]);
    expect(after.rescanAfter).toBeGreaterThan(before);
  });
});

describe("removeShowDate", () => {
  test("deletes the date and asks for a rescan; an unknown date is a no-op", async () => {
    const t = convexTest(schema, modules);
    const h = t.withIdentity(human);
    await h.mutation(api.episodes.addShowDate, { date: D });
    const added = (await list(t)).rescanAfter;
    await new Promise((r) => setTimeout(r, 2));
    await h.mutation(api.episodes.removeShowDate, { date: D });
    const after = await list(t);
    expect(after.extraDates).toEqual([]);
    expect(after.rescanAfter).toBeGreaterThan(added);
    await h.mutation(api.episodes.removeShowDate, { date: "2025-01-03" });
  });

  test("refused while the show has a package in any status", async () => {
    for (const status of ["awaiting_review", "skipped", "succeeded"]) {
      const t = convexTest(schema, modules);
      await t.withIdentity(human).mutation(api.episodes.addShowDate, { date: D });
      await t.run(async (ctx) => {
        const draft = goldenDraft({ id: "pkg-12-26-25", showDate: D } as never);
        await ctx.db.insert("packages", { packageId: draft.id, workspace: "real", status, draft });
      });
      expect(await failure(t.withIdentity(human).mutation(api.episodes.removeShowDate, { date: D }))).toEqual(FROZEN);
      expect(await rows(t)).toHaveLength(1);
    }
  });

  test("refused while a draft run is open", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(human).mutation(api.episodes.addShowDate, { date: D });
    await t.run((ctx) =>
      ctx.db.insert("runs", {
        workspace: "real", runId: "r1", title: "Draft", state: {}, updatedAt: Date.now(), kind: "draft-package", status: "running",
        form: { showDate: D, tracklistText: "x", notes: "" }, createdAt: Date.now(),
      }),
    );
    expect(await failure(t.withIdentity(human).mutation(api.episodes.removeShowDate, { date: D }))).toEqual(FROZEN);
  });

  test("the scanner stops reporting it and prune removes the plain row (a packaged one stays)", async () => {
    const t = convexTest(schema, modules);
    const h = t.withIdentity(human);
    for (const d of [D, "2025-12-19"]) await h.mutation(api.episodes.addShowDate, { date: d });
    for (const d of [D, "2025-12-19"]) await t.mutation(api.ingest.upsert, { token: INGEST, episode: episode(d) });
    await t.run(async (ctx) => {
      const draft = goldenDraft({ id: "pkg-12-19-25", showDate: "2025-12-19" } as never);
      await ctx.db.insert("packages", { packageId: draft.id, workspace: "real", status: "succeeded", draft });
    });
    await h.mutation(api.episodes.removeShowDate, { date: D });
    expect(await t.mutation(api.ingest.prune, { token: INGEST, keep: [] })).toEqual({ deleted: 1 });
    expect((await t.run((ctx) => ctx.db.query("episodes").collect())).map((e) => e.showDate)).toEqual(["2025-12-19"]);
  });
});

describe("placements on an added 2025 Friday", () => {
  const item = { source: "paper" as const, id: "p9", name: "Rhythm Lab Radio 12-26-225", reason: "bad year" };

  test("accepted once the date is added; refused before, in plain words", async () => {
    const t = convexTest(schema, modules);
    const h = t.withIdentity(human);
    await t.mutation(api.ingest.reportUnplaced, { token: INGEST, items: [item] });
    expect(await failure(h.mutation(api.corrections.place, { source: "paper", id: "p9", date: D }))).toEqual({
      code: "BAD_INPUT", message: "the date must be a real 2026 date or a 2025 show added above, yyyy-mm-dd",
    });
    await h.mutation(api.episodes.addShowDate, { date: D });
    await h.mutation(api.corrections.place, { source: "paper", id: "p9", date: D });
    expect((await t.run((ctx) => ctx.db.query("placements").collect())).map((p) => p.date)).toEqual([D]);
  });
});
