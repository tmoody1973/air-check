// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { draftRunFor, goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo" };

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("today.summary", () => {
  test("summary counts awaiting packages in caller workspace only", async () => {
    const t = convexTest(schema, modules);
    const HASH = "b".repeat(64);
    const real = goldenDraft({ id: "real-1", workspace: "real", audio: { hour1Id: "a", hour2Id: "b" } });
    const sample = goldenDraft({ id: "demo-1", workspace: "demo", audio: { hour1Id: "a", hour2Id: "b" } });
    for (const d of [real, sample]) {
      await t.run((ctx) => ctx.db.insert("runs", draftRunFor(d)));
      await t.mutation(internal.packages.submit, { draft: d });
      await t.mutation(internal.packages.attachAudio, { packageId: d.id, audio: { hour1Id: "a", hour2Id: "b", mp3Sha256: HASH } });
    }
    await t.run(async (ctx) => {
      await ctx.db.insert("verifications", { workspace: "real", claim: "A", status: "conflict" });
      await ctx.db.insert("verifications", { workspace: "real", claim: "B", status: "confirmed" });
      await ctx.db.insert("verifications", { workspace: "demo", claim: "C", status: "could-not-verify" });
      await ctx.db.insert("releases", { workspace: "real", artist: "X", title: "1", label: "L1" });
      await ctx.db.insert("releases", { workspace: "real", artist: "Y", title: "2", label: "L1" });
      await ctx.db.insert("releases", { workspace: "real", artist: "Z", title: "3", label: "L2" });
      await ctx.db.insert("releases", { workspace: "demo", artist: "D", title: "4", label: "L9" });
    });

    expect(await t.query(api.today.summary, {})).toBeNull();

    const r = await t.withIdentity(human).query(api.today.summary, {});
    expect(r?.awaiting).toEqual([{ packageId: "real-1", title: real.title, tracks: real.tracks.length, flags: real.flags?.length ?? 0 }]);
    expect(r?.openClaims).toEqual([{ claim: "A", status: "conflict" }]);
    expect(r?.releases).toMatchObject({ count: 3, labels: ["L1", "L2"] });
    expect(r?.releases.items).toHaveLength(2);

    const d = await t.withIdentity(demo).query(api.today.summary, {});
    expect(d?.awaiting.map((a) => a.packageId)).toEqual(["demo-1"]);
    expect(d?.openClaims).toEqual([{ claim: "C", status: "could-not-verify" }]);
    expect(d?.releases.count).toBe(1);
  });

  test("blockedSince counts blocked rows since 18:00 America/Chicago yesterday", async () => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(Date.parse("2026-10-26T12:00:00Z")); // Mon 07:00 CDT; cutoff Sun 18:00 CDT = 23:00Z
    const row = (at: string, result: "blocked" | "done", title: string, workspace: "real" | "demo" = "real") =>
      t.run((ctx) =>
        ctx.db.insert("activity", { workspace, at: Date.parse(at), kind: "network", title, destination: "evil.example", result }),
      );
    await row("2026-10-25T22:59:00Z", "blocked", "before cutoff");
    await row("2026-10-25T23:00:00Z", "blocked", "at cutoff");
    await row("2026-10-26T06:00:00Z", "blocked", "newest");
    await row("2026-10-26T07:00:00Z", "done", "not blocked");
    await row("2026-10-26T08:00:00Z", "blocked", "other workspace", "demo");

    const r = await t.withIdentity(human).query(api.today.summary, {});
    expect(r?.blockedSince).toBe(2);
    expect(r?.blockedLatest).toEqual({ title: "newest", destination: "evil.example" });
  });
});
