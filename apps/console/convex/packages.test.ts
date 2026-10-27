// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
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
