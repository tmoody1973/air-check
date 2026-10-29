// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { draftRunFor, goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// The package page's and Today's reads (Task 6): a signed-in real human only; demo and anonymous get nothing.
const modules = import.meta.glob("./**/*.*s");
const PUB = "p".repeat(48);
const MEDIA = "m".repeat(48);
const HASH = "c".repeat(64);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };
const TODAY = "2026-10-28";
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("PUBLISHER_TOKEN", PUB);
  vi.stubEnv("MEDIA_TOKEN", MEDIA);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const pkg = (t: T, id: string) => t.run((ctx) => ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique());
const image = (t: T) => t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));

async function reviewable(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" }, ...overrides });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  if (draft.workspace === "demo")
    await t.mutation(internal.packages.attachAudio, { packageId: draft.id, audio: { hour1Id: "pending", hour2Id: "pending", mp3Sha256: HASH } });
  else
    await t.mutation(api.media.attached, { token: MEDIA, packageId: draft.id, hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: HASH, hour1DurationSec: 3600, mp3Bytes: 10 });
  return draft.id;
}
async function approved(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const id = await reviewable(t, overrides);
  const as = overrides.workspace === "demo" ? t.withIdentity(demo) : t.withIdentity(human);
  await as.mutation(api.packages.decide, { packageId: id, fingerprint: (await pkg(t, id))!.fingerprint!, decision: "approve" });
  return id;
}
const published = async (t: T, id: string) => {
  await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
  await t.mutation(api.publisher.result, { token: PUB, packageId: id, result: { status: "succeeded", url: "https://www.mixcloud.com/rhythmlab/x/" } });
};

describe("packages.publishState (R2)", () => {
  test("I3: carries the publisher's last error code, so the page can say why posting is paused", async () => {
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", "standard-cover");
    const t = convexTest(schema, modules);
    const id = await approved(t);
    await t.mutation(api.publisher.setMixcloud, { token: PUB, state: "connected", account: "rhythmlab", lastError: "cover_unavailable" });
    expect(await t.withIdentity(human).query(api.packages.publishState, { packageId: id, today: TODAY }))
      .toEqual({ dayOffset: 0, mixcloudState: "connected", lastError: "cover_unavailable" });
  });

  test("day offset follows the publisher's order (oldest show first, 3 a day) and counts today's posts", async () => {
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", "standard-cover");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
    const t = convexTest(schema, modules);
    await published(t, await approved(t, { id: "pkg-9-1-26", showDate: "2026-09-01" }));
    const ids = [];
    for (const d of ["08", "15", "22", "29"]) ids.push(await approved(t, { id: `pkg-9-${Number(d)}-26`, showDate: `2026-09-${d}` }));
    const as = t.withIdentity(human);
    const offsets = await Promise.all(ids.map((packageId) => as.query(api.packages.publishState, { packageId, today: TODAY })));
    // One already went up today, so two more post today and the next three tomorrow.
    expect(offsets.map((s) => s?.dayOffset)).toEqual([0, 0, 1, 1]);
    expect(offsets[0]!.mixcloudState).toBe("not_connected");
    await t.mutation(api.publisher.setMixcloud, { token: PUB, state: "connected", account: "rhythmlab" });
    expect(await as.query(api.packages.publishState, { packageId: ids[0]!, today: TODAY })).toEqual({ dayOffset: 0, mixcloudState: "connected" });
  });

  test("counts against the client's Chicago day, so a page open across midnight re-asks with the new day", async () => {
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", "standard-cover");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T04:30:00Z")); // 23:30 CDT Oct 27
    const t = convexTest(schema, modules);
    await published(t, await approved(t, { id: "pkg-9-1-26", showDate: "2026-09-01" }));
    const ids = [];
    for (const d of ["08", "15", "22"]) ids.push(await approved(t, { id: `pkg-9-${Number(d)}-26`, showDate: `2026-09-${d}` }));
    const as = t.withIdentity(human);
    const offsets = (today: string) => Promise.all(ids.map((packageId) => as.query(api.packages.publishState, { packageId, today }).then((s) => s?.dayOffset)));
    // Same data, same server clock: before midnight one post already counts, after midnight none does.
    expect(await offsets("2026-10-27")).toEqual([0, 0, 1]);
    expect(await offsets("2026-10-28")).toEqual([0, 0, 0]);
  });

  test.each(["", "2026-10-2", "10/28/2026", "2026-10-28T00:00", "today"])("a malformed today (%j) is refused", async (today) => {
    const t = convexTest(schema, modules);
    const id = await approved(t);
    await expect(t.withIdentity(human).query(api.packages.publishState, { packageId: id, today })).rejects.toThrow(/BAD_INPUT/);
  });

  test("not queued (awaiting review, published) or no cover anywhere → dayOffset null", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const waiting = await reviewable(t, { id: "pkg-9-8-26", showDate: "2026-09-08" });
    expect(await as.query(api.packages.publishState, { packageId: waiting, today: TODAY })).toMatchObject({ dayOffset: null });
    // The publisher skips a package with neither its own cover nor the standard one, so it is not queued.
    const bare = await approved(t);
    expect(await as.query(api.packages.publishState, { packageId: bare, today: TODAY })).toMatchObject({ dayOffset: null });
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", "standard-cover");
    expect(await as.query(api.packages.publishState, { packageId: bare, today: TODAY })).toMatchObject({ dayOffset: 0 });
  });

  test("demo, anonymous, a demo package and a missing package → null", async () => {
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", "standard-cover");
    const t = convexTest(schema, modules);
    const real = await approved(t);
    const demoId = await approved(t, { id: "demo-10-2-26", workspace: "demo" });
    expect(await t.query(api.packages.publishState, { packageId: real, today: TODAY })).toBeNull();
    expect(await t.withIdentity(demo).query(api.packages.publishState, { packageId: real, today: TODAY })).toBeNull();
    expect(await t.withIdentity(demo).query(api.packages.publishState, { packageId: demoId, today: TODAY })).toBeNull();
    expect(await t.withIdentity(human).query(api.packages.publishState, { packageId: demoId, today: TODAY })).toBeNull();
    expect(await t.withIdentity(human).query(api.packages.publishState, { packageId: "pkg-1-1-26", today: TODAY })).toBeNull();
  });
});

describe("packages.coverPreview (R5)", () => {
  test("the package's own cover, else the standard cover, else null", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const id = await reviewable(t);
    expect(await as.query(api.packages.coverPreview, { packageId: id })).toBeNull();
    const standard = await image(t);
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", standard);
    const standardUrl = await t.run((ctx) => ctx.storage.getUrl(standard));
    expect(await as.query(api.packages.coverPreview, { packageId: id })).toBe(standardUrl);
    const own = await image(t);
    await as.mutation(api.packages.setCover, { packageId: id, storageId: own });
    expect(await as.query(api.packages.coverPreview, { packageId: id })).toBe(await t.run((ctx) => ctx.storage.getUrl(own)));
  });

  test("a malformed standard cover id is null, not an error", async () => {
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", "not-a-storage-id");
    const t = convexTest(schema, modules);
    const id = await reviewable(t);
    expect(await t.withIdentity(human).query(api.packages.coverPreview, { packageId: id })).toBeNull();
  });

  test("demo, anonymous and demo packages get null", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("STANDARD_COVER_STORAGE_ID", await image(t));
    const real = await reviewable(t);
    const demoId = await reviewable(t, { id: "demo-10-2-26", workspace: "demo" });
    expect(await t.query(api.packages.coverPreview, { packageId: real })).toBeNull();
    expect(await t.withIdentity(demo).query(api.packages.coverPreview, { packageId: real })).toBeNull();
    expect(await t.withIdentity(human).query(api.packages.coverPreview, { packageId: demoId })).toBeNull();
  });
});

describe("media.issues (R5)", () => {
  test("a real human reads the current rows, oldest show first; demo and anonymous get none", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.media.waiting, {
      token: MEDIA,
      items: [
        { showDate: "2026-10-16", reason: "2026-10-16 has audio but no draft package for that date yet" },
        { showDate: "2026-10-09", reason: "2026-10-09 needs exactly two .wav files; found 1" },
      ],
    });
    expect(await t.withIdentity(human).query(api.media.issues, {})).toEqual([
      { showDate: "2026-10-09", reason: "2026-10-09 needs exactly two .wav files; found 1" },
      { showDate: "2026-10-16", reason: "2026-10-16 has audio but no draft package for that date yet" },
    ]);
    expect(await t.withIdentity(demo).query(api.media.issues, {})).toEqual([]);
    expect(await t.query(api.media.issues, {})).toEqual([]);
  });
});
