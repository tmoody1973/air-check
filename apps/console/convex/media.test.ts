// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fingerprint } from "@aircheck/core";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const MEDIA = "m".repeat(48);
const HASH = "c".repeat(64);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };

beforeEach(() => vi.stubEnv("MEDIA_TOKEN", MEDIA));
afterEach(() => vi.unstubAllEnvs());

/** An agent-submitted package: its hour ids are placeholders the media job must replace (R3). */
async function submitted(t: ReturnType<typeof convexTest>, overrides = {}) {
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" }, ...overrides });
  await t.mutation(internal.packages.submit, { draft });
  return draft.id;
}
const attach = (t: ReturnType<typeof convexTest>, packageId: string, token = MEDIA) =>
  t.mutation(api.media.attached, { token, packageId, hour1Id: "9125.wav", hour2Id: "9126.wav", mp3Sha256: HASH, hour1DurationSec: 3601, mp3Bytes: 150_000_000 });
const pkg = (t: ReturnType<typeof convexTest>, id: string) =>
  t.run((ctx) => ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique());
const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
  return "no error";
};

describe("media.pending", () => {
  test("lists real packages preparing audio, never demo or reviewed ones", async () => {
    const t = convexTest(schema, modules);
    const id = await submitted(t);
    await submitted(t, { id: "demo-10-2-26", workspace: "demo" });
    const done = await submitted(t, { id: "pkg-10-9-26", showDate: "2026-10-09" });
    await attach(t, done);
    expect(await t.query(api.media.pending, { token: MEDIA })).toEqual([{ packageId: id, showDate: "2026-10-02" }]);
  });
});

describe("media.attached", () => {
  test("an agent draft with placeholder hour ids takes the real filenames and turns approvable", async () => {
    const t = convexTest(schema, modules);
    const id = await submitted(t);
    await attach(t, id);
    const doc = await pkg(t, id);
    expect(doc?.status).toBe("awaiting_review");
    expect(doc?.draft.audio).toEqual({ hour1Id: "9125.wav", hour2Id: "9126.wav", mp3Sha256: HASH, hour1DurationSec: 3601, mp3Bytes: 150_000_000 });
    const { mp3Bytes, hour1DurationSec, ...hashed } = doc!.draft.audio;
    void mp3Bytes, hour1DurationSec;
    expect(doc?.fingerprint).toBe(await fingerprint({ ...doc!.draft, audio: hashed }));
  });

  test("a package that is not preparing audio is NOT_READY and unchanged", async () => {
    const t = convexTest(schema, modules);
    const id = await submitted(t);
    await attach(t, id);
    const before = await pkg(t, id);
    expect(await errorCode(attach(t, id))).toBe("NOT_READY");
    expect(await pkg(t, id)).toEqual(before);
  });

  test("a demo package is never touched", async () => {
    const t = convexTest(schema, modules);
    const id = await submitted(t, { id: "demo-10-2-26", workspace: "demo" });
    expect(await errorCode(attach(t, id))).toBe("NOT_READY");
    expect((await pkg(t, id))?.status).toBe("preparing_audio");
  });

  test("a missing package is NOT_FOUND; a malformed hash is refused", async () => {
    const t = convexTest(schema, modules);
    expect(await errorCode(attach(t, "pkg-nope"))).toBe("NOT_FOUND");
    const id = await submitted(t);
    const bad = t.mutation(api.media.attached, { token: MEDIA, packageId: id, hour1Id: "a.wav", hour2Id: "b.wav", mp3Sha256: "nope", hour1DurationSec: 1, mp3Bytes: 1 });
    expect(await errorCode(bad)).toBe("BAD_INPUT");
    expect((await pkg(t, id))?.status).toBe("preparing_audio");
  });
});

describe("media.waiting", () => {
  test("replaces the whole issue set, so a fixed problem clears", async () => {
    const t = convexTest(schema, modules);
    const items = [{ showDate: "2026-10-09", reason: "needs exactly two .wav files; found 1" }, { showDate: "2026-10-16", reason: "no files" }];
    await t.mutation(api.media.waiting, { token: MEDIA, items });
    await t.mutation(api.media.waiting, { token: MEDIA, items: items.slice(1) });
    const rows = await t.run((ctx) => ctx.db.query("audioIssues").collect());
    expect(rows.map(({ showDate, reason }) => ({ showDate, reason }))).toEqual(items.slice(1));
    await t.mutation(api.media.waiting, { token: MEDIA, items: [] });
    expect(await t.run((ctx) => ctx.db.query("audioIssues").collect())).toEqual([]);
  });
});

describe("media.waiting: an unchanged set writes nothing", () => {
  test("the same items (in any order) leave the stored rows as they are", async () => {
    const t = convexTest(schema, modules);
    const items = [{ showDate: "2026-10-09", reason: "a" }, { showDate: "2026-10-16", reason: "b" }];
    await t.mutation(api.media.waiting, { token: MEDIA, items });
    const before = await t.run((ctx) => ctx.db.query("audioIssues").collect());
    await t.mutation(api.media.waiting, { token: MEDIA, items: [...items].reverse() });
    expect(await t.run((ctx) => ctx.db.query("audioIssues").collect())).toEqual(before); // same _ids: no delete/re-insert
    await t.mutation(api.media.waiting, { token: MEDIA, items: [items[0]!, { showDate: "2026-10-16", reason: "c" }] });
    const after = await t.run((ctx) => ctx.db.query("audioIssues").collect());
    expect(after.map(({ showDate, reason }) => ({ showDate, reason }))).toEqual([items[0], { showDate: "2026-10-16", reason: "c" }]);
  });
});

describe("media.statuses", () => {
  test("the status of each real package asked about; demo and unknown ids are left out", async () => {
    const t = convexTest(schema, modules);
    const id = await submitted(t);
    await attach(t, id);
    await submitted(t, { id: "demo-10-2-26", workspace: "demo" });
    const got = await t.query(api.media.statuses, { token: MEDIA, packageIds: [id, "demo-10-2-26", "pkg-1-1-99"] });
    expect(got).toEqual([{ packageId: id, status: "awaiting_review" }]);
  });
});

describe("media.cleanup", () => {
  test("returns only skipped and succeeded real packages", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
    const ids = ["pkg-1-1-26", "pkg-1-2-26", "pkg-1-3-26", "pkg-1-4-26"];
    for (const id of ids) {
      await submitted(t, { id });
      await attach(t, id);
    }
    const as = t.withIdentity(human);
    const decide = async (id: string, decision: "approve" | "skip") =>
      as.mutation(api.packages.decide, { packageId: id, fingerprint: (await pkg(t, id))!.fingerprint!, decision });
    await decide(ids[0]!, "skip");
    await decide(ids[1]!, "approve");
    await decide(ids[2]!, "approve");
    await t.mutation(api.publisher.claim, { token: "p".repeat(48), packageId: ids[2]! });
    await t.mutation(api.publisher.result, { token: "p".repeat(48), packageId: ids[2]!, result: { status: "succeeded", url: "https://www.mixcloud.com/rhythmlab/x/" } });
    expect((await t.query(api.media.cleanup, { token: MEDIA })).sort()).toEqual([ids[0], ids[2]].sort());
  });
});

describe("fail closed", () => {
  const calls = (t: ReturnType<typeof convexTest>, token: string, id: string) => [
    t.query(api.media.pending, { token }),
    attach(t, id, token),
    t.mutation(api.media.waiting, { token, items: [{ showDate: "2026-10-09", reason: "x" }] }),
    t.query(api.media.cleanup, { token }),
    t.query(api.media.statuses, { token, packageIds: [id] }),
  ];
  const snapshot = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => [await ctx.db.query("packages").collect(), await ctx.db.query("audioIssues").collect()]);

  test.each([
    ["wrong token", "w".repeat(48)],
    ["empty token", ""],
    ["the publisher's token", "p".repeat(48)],
  ])("%s is refused and writes nothing", async (_n, token) => {
    vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
    const t = convexTest(schema, modules);
    const id = await submitted(t);
    const before = await snapshot(t);
    for (const call of calls(t, token, id)) expect(await errorCode(call)).toBe("UNAUTHORIZED");
    expect(await snapshot(t)).toEqual(before);
  });

  test("MEDIA_TOKEN equal to PUBLISHER_TOKEN: everything is refused (fail closed)", async () => {
    vi.stubEnv("PUBLISHER_TOKEN", MEDIA);
    const t = convexTest(schema, modules);
    const id = await submitted(t);
    const before = await snapshot(t);
    for (const call of calls(t, MEDIA, id)) expect(await errorCode(call)).toBe("UNAUTHORIZED");
    expect(await snapshot(t)).toEqual(before);
  });

  test.each([["unset", undefined], ["31 characters", "m".repeat(31)]])("MEDIA_TOKEN %s: everything is refused", async (_n, env) => {
    const t = convexTest(schema, modules);
    const id = await submitted(t);
    vi.stubEnv("MEDIA_TOKEN", env ?? "");
    const before = await snapshot(t);
    for (const call of calls(t, env ?? "", id)) expect(await errorCode(call)).toBe("UNAUTHORIZED");
    expect(await snapshot(t)).toEqual(before);
  });
});
