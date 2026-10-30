import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.*s");
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo" };

describe("memory.learned (Oct 30: Skills and memory page)", () => {
  test("Tarik's fixes, passes with reasons, release edits and edited research blocks, newest first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("corrections", { showDate: "2026-10-02", tracklistText: "HOUR 1", updatedAt: 1 });
      await ctx.db.insert("corrections", { showDate: "2026-10-09", box: "folder", hours: { hour1: "a", hour2: "b" }, updatedAt: 2 });
      await ctx.db.insert("releases", { workspace: "real", artist: "Versa", title: "Reset", status: "passed", statusAt: 5, passReason: "Too close to last week's set" });
      await ctx.db.insert("releases", { workspace: "real", artist: "Mocky", title: "Amaimono", status: "passed", statusAt: 6 });
      await ctx.db.insert("releases", { workspace: "real", artist: "Waeys", title: "Decked Out", editedFields: ["title"] });
      await ctx.db.insert("research", { workspace: "real", jobId: "rj-aaa111", kind: "deep-dive", subject: { type: "artist", name: "Massive Attack" }, angles: false, status: "done", runIds: [], continuations: 0, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("researchEntries", { workspace: "real", jobId: "rj-aaa111", key: "brief", block: "brief", claims: [], edited: { text: "Mine.", at: 9 }, updatedAt: 9 });
    });
    const got = await t.withIdentity(human).query(api.memory.learned, {});
    expect(got!.fixes).toEqual([
      { showDate: "2026-10-09", parts: ["Box folder", "hour files"], at: 2 },
      { showDate: "2026-10-02", parts: ["tracklist"], at: 1 },
    ]);
    expect(got!.passes).toEqual([{ artist: "Versa", title: "Reset", reason: "Too close to last week's set", at: 5 }]); // a pass with no reason teaches nothing
    expect(got!.releaseEdits).toEqual([{ artist: "Waeys", title: "Decked Out", fields: ["title"] }]);
    expect(got!.researchEdits).toEqual([{ label: "Deep dive: Massive Attack", key: "brief", at: 9 }]);
    expect(got!.counts).toEqual({ fixes: 2, passes: 1, releaseEdits: 1, researchEdits: 1 });
  });

  test("the demo sees only its own workspace and no station fixes; signed out gets null", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("corrections", { showDate: "2026-10-02", tracklistText: "x", updatedAt: 1 });
      await ctx.db.insert("releases", { workspace: "real", artist: "Versa", title: "Reset", status: "passed", statusAt: 5, passReason: "private reason" });
    });
    const got = await t.withIdentity(demo).query(api.memory.learned, {});
    expect(got).toMatchObject({ fixes: [], passes: [], counts: { fixes: 0, passes: 0 } });
    expect(await t.query(api.memory.learned, {})).toBeNull();
  });
});
