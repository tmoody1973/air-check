// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const HASH = "b".repeat(64);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };

async function seed(t: ReturnType<typeof convexTest>, overrides = {}) {
  const draft = goldenDraft({ audio: { hour1Id: "box-h1", hour2Id: "box-h2" }, ...overrides });
  await t.mutation(internal.packages.submit, { draft });
  const rec = await t.mutation(internal.packages.attachAudio, {
    packageId: draft.id,
    audio: { hour1Id: "box-h1", hour2Id: "box-h2", mp3Sha256: HASH },
  });
  return { id: draft.id, fp: rec.fingerprint as string, title: draft.title };
}

const rows = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("activity").collect());

describe("packages.decide", () => {
  test("anonymous cannot decide", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const r = await t.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  test("outside-domain identity cannot decide", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const as = t.withIdentity({ subject: "x", email: "x@gmail.com", emailVerified: true });
    const r = await as.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  test("real identity approves a real package", async () => {
    const t = convexTest(schema, modules);
    const { id, fp, title } = await seed(t);
    const r = await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(r.ok && r.record.status).toBe("approved");
    const approved = (await rows(t)).filter((a) => a.title === `Approved package ${title}`);
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ kind: "action", result: "done", workspace: "real", packageId: id });
    expect((await rows(t)).find((a) => a.kind === "waiting")).toMatchObject({
      title: "Package ready for your approval",
      result: "needs_you",
    });
  });

  test("decide with stale fingerprint returns PACKAGE_CHANGED", async () => {
    const t = convexTest(schema, modules);
    const { id } = await seed(t);
    const r = await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: "stale", decision: "approve" });
    expect(r).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
  });

  test("demo identity cannot read a real package", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const demo = t.withIdentity({ subject: "d1", role: "demo" });
    expect(await demo.query(api.packages.get, { packageId: id })).toBeNull();
    expect(await demo.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  test("demo identity gets the same FORBIDDEN for a missing package as for a real one", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const demo = t.withIdentity({ subject: "d1", role: "demo" });
    const real = await demo.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    const missing = await demo.mutation(api.packages.decide, { packageId: "no-such-package", fingerprint: fp, decision: "approve" });
    expect(missing).toEqual(real);
    expect(missing).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  test("a human still gets NOT_FOUND for a missing package", async () => {
    const t = convexTest(schema, modules);
    const r = await t.withIdentity(human).mutation(api.packages.decide, { packageId: "no-such-package", fingerprint: "x", decision: "approve" });
    expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  test("real identity cannot decide a demo package", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t, { id: "pkg-demo", workspace: "demo" });
    const before = (await rows(t)).length;
    const r = await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(r).toEqual({ ok: false, code: "FORBIDDEN", message: expect.any(String) });
    const doc = await t.run((ctx) => ctx.db.query("packages").first());
    expect(doc?.status).toBe("awaiting_review");
    expect(await rows(t)).toHaveLength(before);
  });

  test("decide after a different decision returns PACKAGE_CHANGED", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const as = t.withIdentity(human);
    const skip = await as.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "skip" });
    expect(skip.ok).toBe(true);
    const r = await as.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(r).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
    const again = await as.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "skip" });
    expect(again.ok).toBe(true);
    expect((await rows(t)).filter((a) => a.title.startsWith("Skipped package"))).toHaveLength(1);
  });

  test("demo identity can approve a demo package", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t, { id: "pkg-demo", workspace: "demo" });
    const demo = t.withIdentity({ subject: "d1", role: "demo" });
    expect(await demo.query(api.packages.get, { packageId: id })).not.toBeNull();
    expect(await demo.query(api.packages.listAwaiting, {})).toHaveLength(1);
    const r = await demo.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(r.ok && r.record.status).toBe("approved");
    expect((await rows(t)).every((a) => a.workspace === "demo")).toBe(true);
  });

  test("two concurrent decides write one approved activity row", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const as = t.withIdentity(human);
    const args = { packageId: id, fingerprint: fp, decision: "approve" as const };
    const [a, b] = await Promise.all([as.mutation(api.packages.decide, args), as.mutation(api.packages.decide, args)]);
    expect(a.ok && b.ok).toBe(true);
    expect((await rows(t)).filter((r) => r.title.startsWith("Approved package"))).toHaveLength(1);
  });

  test("activity.list blocked filter returns only blocked rows", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("activity", { workspace: "real", at: 1, kind: "network", title: "Blocked evil.example", result: "blocked" }),
    );
    const as = t.withIdentity(human);
    const blocked = await as.query(api.activity.list, { kind: "blocked" });
    expect(blocked.map((r) => r.title)).toEqual(["Blocked evil.example"]);
    expect((await as.query(api.activity.list, {})).length).toBeGreaterThan(1);
    expect(await t.query(api.activity.list, {})).toEqual([]);
  });
});

// I2: a failed or uncertain upload is not a dead end. Only a signed-in real human reopens it or confirms the post.
describe("packages.reopen and packages.confirmPosted", () => {
  const PUB = "p".repeat(48);
  const SHOW = "https://www.mixcloud.com/rhythmlab/rlr-10-2-26/";
  beforeEach(() => vi.stubEnv("PUBLISHER_TOKEN", PUB));
  afterEach(() => vi.unstubAllEnvs());

  async function finished(t: ReturnType<typeof convexTest>, result: { status: "failed"; error: string } | { status: "outcome_unknown" }) {
    const { id, fp } = await seed(t);
    await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    await t.mutation(api.publisher.claim, { token: PUB, packageId: id });
    await t.mutation(api.publisher.result, { token: PUB, packageId: id, result });
    return { id, fp };
  }
  const doc = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("packages").first());

  test("reopen: failed -> awaiting_review with the result and decision cleared; approve again to publish", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await finished(t, { status: "failed", error: "audio changed since approval" });
    const r = await t.withIdentity(human).mutation(api.packages.reopen, { packageId: id });
    expect(r.ok && r.record.status).toBe("awaiting_review");
    const d = await doc(t);
    expect(d).toMatchObject({ status: "awaiting_review", fingerprint: fp });
    expect(d?.result).toBeUndefined();
    expect(d?.decidedBy).toBeUndefined();
    expect((await rows(t)).at(-1)).toMatchObject({ title: "Package ready for your approval", kind: "waiting", result: "needs_you", packageId: id });
    const again = await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(again.ok && again.record.status).toBe("approved");
  });

  test("confirmPosted: outcome_unknown -> succeeded with the URL; a bad URL is refused", async () => {
    const t = convexTest(schema, modules);
    const { id } = await finished(t, { status: "outcome_unknown" });
    const as = t.withIdentity(human);
    expect(await as.mutation(api.packages.confirmPosted, { packageId: id, url: "https://evil.example/x" })).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect((await doc(t))?.status).toBe("outcome_unknown");
    const r = await as.mutation(api.packages.confirmPosted, { packageId: id, url: SHOW });
    expect(r.ok && r.record.result?.url).toBe(SHOW);
    expect((await doc(t))?.status).toBe("succeeded");
    expect((await rows(t)).at(-1)).toMatchObject({ title: `Published package ${id}`, kind: "action", result: "done" });
  });

  test("anonymous, outside-domain and demo callers are refused and nothing changes", async () => {
    const t = convexTest(schema, modules);
    const { id } = await finished(t, { status: "outcome_unknown" });
    const before = await doc(t);
    for (const as of [t, t.withIdentity({ subject: "x", email: "x@gmail.com", emailVerified: true }), t.withIdentity({ subject: "d1", role: "demo" })]) {
      expect(await as.mutation(api.packages.reopen, { packageId: id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await as.mutation(api.packages.confirmPosted, { packageId: id, url: SHOW })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await doc(t)).toEqual(before);
  });

  test("a demo package is never reopened by a real human", async () => {
    const t = convexTest(schema, modules);
    const draft = goldenDraft({ id: "demo-1", workspace: "demo", audio: { hour1Id: "h1", hour2Id: "h2" } });
    await t.mutation(internal.packages.submit, { draft });
    expect(await t.withIdentity(human).mutation(api.packages.reopen, { packageId: "demo-1" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  test("reopen is refused while approved or after success", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const as = t.withIdentity(human);
    await as.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(await as.mutation(api.packages.reopen, { packageId: id })).toMatchObject({ ok: false, code: "NOT_READY" });
    expect((await doc(t))?.status).toBe("approved");
  });
});
