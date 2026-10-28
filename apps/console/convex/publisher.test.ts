// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const PUB = "p".repeat(48);
const MEDIA = "m".repeat(48);
const HASH = "c".repeat(64);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const URL_ = "https://www.mixcloud.com/rhythmlab/x/";

beforeEach(() => {
  vi.stubEnv("PUBLISHER_TOKEN", PUB);
  vi.stubEnv("MEDIA_TOKEN", MEDIA);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;
const pkg = (t: T, id: string) => t.run((ctx) => ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique());
const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
  return "no error";
};

/** submit -> media.attached -> awaiting_review. */
async function reviewable(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" }, ...overrides });
  await t.mutation(internal.packages.submit, { draft });
  // The media service never touches demo packages, so demo audio is attached directly (as the seed does).
  if (draft.workspace === "demo")
    await t.mutation(internal.packages.attachAudio, { packageId: draft.id, audio: { hour1Id: "pending", hour2Id: "pending", mp3Sha256: HASH } });
  else
    await t.mutation(api.media.attached, { token: MEDIA, packageId: draft.id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: HASH, hour1DurationSec: 3600, mp3Bytes: 10 });
  return draft.id;
}
async function approved(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const id = await reviewable(t, overrides);
  const as = overrides.workspace === "demo" ? t.withIdentity({ subject: "d1", role: "demo" }) : t.withIdentity(human);
  await as.mutation(api.packages.decide, { packageId: id, fingerprint: (await pkg(t, id))!.fingerprint!, decision: "approve" });
  return id;
}
const published = async (t: T, id: string) => {
  await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
  await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: URL_ } });
};

describe("publisher.queue", () => {
  test("lists approved real packages with what the upload needs; never demo, never unapproved", async () => {
    const t = convexTest(schema, modules);
    const id = await approved(t);
    await approved(t, { id: "demo-10-2-26", workspace: "demo" });
    await reviewable(t, { id: "pkg-10-9-26", showDate: "2026-10-09" });
    const q = await t.query(api.publisher.queue, { token: PUB });
    const doc = (await pkg(t, id))!;
    expect(q.publishedToday).toBe(0);
    expect(q.packages).toEqual([{ packageId: id, showDate: "2026-10-02", decidedAt: doc.decidedAt, draft: doc.draft, fingerprint: doc.fingerprint }]);
  });

  test("coverStorageId: the package's own cover, else the standard cover", async () => {
    const t = convexTest(schema, modules);
    const cover = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
    const id = await reviewable(t);
    await t.withIdentity(human).mutation(api.packages.setCover, { packageId: id, storageId: cover });
    const as = t.withIdentity(human);
    await as.mutation(api.packages.decide, { packageId: id, fingerprint: (await pkg(t, id))!.fingerprint!, decision: "approve" });
    const other = await approved(t, { id: "pkg-10-9-26", showDate: "2026-10-09" });
    const cover0 = (await t.query(api.publisher.queue, { token: PUB })).packages;
    expect(cover0.find((p) => p.packageId === id)?.coverStorageId).toBe(cover);
    expect(cover0.find((p) => p.packageId === other)).not.toHaveProperty("coverStorageId");
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", "standard-cover");
    const cover1 = (await t.query(api.publisher.queue, { token: PUB })).packages;
    expect(cover1.find((p) => p.packageId === id)?.coverStorageId).toBe(cover);
    expect(cover1.find((p) => p.packageId === other)?.coverStorageId).toBe("standard-cover");
  });

  test("publishedToday counts successes in the current Chicago day, across Chicago midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = convexTest(schema, modules);
    vi.setSystemTime(new Date("2026-10-28T04:30:00Z")); // 23:30 CDT Oct 27
    await published(t, await approved(t, { id: "pkg-a", showDate: "2026-09-01" }));
    vi.setSystemTime(new Date("2026-10-28T04:59:00Z"));
    expect((await t.query(api.publisher.queue, { token: PUB })).publishedToday).toBe(1);
    vi.setSystemTime(new Date("2026-10-28T05:00:01Z")); // 00:00 CDT Oct 28
    expect((await t.query(api.publisher.queue, { token: PUB })).publishedToday).toBe(0);
    await published(t, await approved(t, { id: "pkg-b", showDate: "2026-09-08" }));
    const failed = await approved(t, { id: "pkg-c", showDate: "2026-09-15" });
    await t.mutation(api.publisher.claim, { token: PUB, packageId: failed });
    await t.mutation(api.publisher.result, { token: PUB, packageId: failed, result: { status: "failed", error: "x" } });
    expect((await t.query(api.publisher.queue, { token: PUB })).publishedToday).toBe(1);
  });
});

describe("publisher.claim / result", () => {
  test("claim takes an approved package to publishing once; result records the receipt", async () => {
    const t = convexTest(schema, modules);
    const id = await approved(t);
    const claimed = await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    expect(claimed.status).toBe("publishing");
    expect(await errorCode(t.mutation(api.publisher.claim, { token: PUB, packageId: id }))).toBe("NOT_READY");
    await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: URL_ } });
    const doc = await pkg(t, id);
    expect(doc?.status).toBe("succeeded");
    expect(doc?.result).toMatchObject({ url: URL_, at: expect.any(String) });
  });

  test("a demo package cannot be claimed", async () => {
    const t = convexTest(schema, modules);
    const id = await approved(t, { id: "demo-10-2-26", workspace: "demo" });
    expect(await errorCode(t.mutation(api.publisher.claim, { token: PUB, packageId: id }))).toBe("DEMO_CANNOT_PUBLISH");
    expect((await pkg(t, id))?.status).toBe("approved");
  });

  test("result on a package that is not publishing is NOT_READY", async () => {
    const t = convexTest(schema, modules);
    const id = await approved(t);
    const r = t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: URL_ } });
    expect(await errorCode(r)).toBe("NOT_READY");
    expect((await pkg(t, id))?.status).toBe("approved");
  });
});

describe("publisher.reconcile", () => {
  test("moves publishing to outcome_unknown and touches nothing else", async () => {
    const t = convexTest(schema, modules);
    const stuck = await approved(t, { id: "pkg-stuck" });
    await t.mutation(api.publisher.claim, { token: PUB, packageId: stuck });
    const waiting = await approved(t, { id: "pkg-waiting" });
    const done = await approved(t, { id: "pkg-done" });
    await published(t, done);
    const review = await reviewable(t, { id: "pkg-review" });
    const before = await Promise.all([waiting, done, review].map((id) => pkg(t, id)));
    expect(await t.mutation(api.publisher.reconcile, { token: PUB })).toEqual({ reconciled: [stuck] });
    expect((await pkg(t, stuck))?.status).toBe("outcome_unknown");
    expect(await Promise.all([waiting, done, review].map((id) => pkg(t, id)))).toEqual(before);
    expect(await errorCode(t.mutation(api.publisher.claim, { token: PUB, packageId: stuck }))).toBe("NOT_READY");
    expect(await t.mutation(api.publisher.reconcile, { token: PUB })).toEqual({ reconciled: [] });
  });
});

describe("publisher.coverUrl", () => {
  test("returns a URL for a stored cover", async () => {
    const t = convexTest(schema, modules);
    const cover = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
    expect(await t.query(api.publisher.coverUrl, { token: PUB, storageId: cover })).toEqual(expect.any(String));
  });
});

describe("publisher.setMixcloud", () => {
  test("writes the one status row; a credential field is refused by the validator", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.publisher.setMixcloud, { token: PUB, state: "needs_reconnect", lastError: "invalid_token" });
    await t.mutation(api.publisher.setMixcloud, { token: PUB, state: "not_connected" });
    const rows = await t.run((ctx) => ctx.db.query("mixcloudStatus").collect());
    expect(rows.map(({ state, lastError }) => ({ state, lastError }))).toEqual([{ state: "not_connected", lastError: undefined }]);
    const leak = { token: PUB, state: "connected", accessToken: "secret" } as unknown as { token: string; state: "connected" };
    await expect(t.mutation(api.publisher.setMixcloud, leak)).rejects.toThrow();
  });
});

describe("fail closed", () => {
  const snapshot = (t: T) => t.run(async (ctx) => [await ctx.db.query("packages").collect(), await ctx.db.query("mixcloudStatus").collect()]);
  const calls = async (t: T, token: string, id: string) => {
    const cover = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
    return [
      t.query(api.publisher.queue, { token }),
      t.mutation(api.publisher.claim, { token, packageId: id }),
      t.mutation(api.publisher.result, { token, packageId: id, result: { status: "outcome_unknown" } }),
      t.mutation(api.publisher.reconcile, { token }),
      t.query(api.publisher.coverUrl, { token, storageId: cover }),
      t.mutation(api.publisher.setMixcloud, { token, state: "connected", account: "rhythmlab" }),
    ];
  };

  test.each([
    ["wrong token", "w".repeat(48)],
    ["empty token", ""],
    ["the media token", MEDIA],
  ])("%s is refused and writes nothing", async (_n, token) => {
    const t = convexTest(schema, modules);
    const id = await approved(t);
    const before = await snapshot(t);
    for (const call of await calls(t, token, id)) expect(await errorCode(call)).toBe("UNAUTHORIZED");
    expect(await snapshot(t)).toEqual(before);
  });

  test.each([["unset", undefined], ["31 characters", "p".repeat(31)]])("PUBLISHER_TOKEN %s: everything is refused", async (_n, env) => {
    const t = convexTest(schema, modules);
    const id = await approved(t);
    vi.stubEnv("PUBLISHER_TOKEN", env ?? "");
    const before = await snapshot(t);
    for (const call of await calls(t, env ?? "", id)) expect(await errorCode(call)).toBe("UNAUTHORIZED");
    expect(await snapshot(t)).toEqual(before);
  });
});
