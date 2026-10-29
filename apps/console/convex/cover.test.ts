// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { fingerprint } from "@aircheck/core";
import { draftRunFor, goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const HASH = "b".repeat(64);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };
type T = ReturnType<typeof convexTest>;

async function seed(t: T, overrides = {}) {
  const draft = goldenDraft({ audio: { hour1Id: "box-h1", hour2Id: "box-h2" }, ...overrides });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  const rec = await t.mutation(internal.packages.attachAudio, { packageId: draft.id, audio: { hour1Id: "box-h1", hour2Id: "box-h2", mp3Sha256: HASH } });
  return { id: draft.id, fp: rec.fingerprint as string };
}
const image = (t: T, type = "image/jpeg") => t.run((ctx) => ctx.storage.store(new Blob(["img"], { type })));
const pkg = (t: T, id: string) => t.run((ctx) => ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique());

describe("packages.setCover", () => {
  test("a human sets the cover while awaiting review and the package re-fingerprints", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const cover = await image(t);
    const r = await t.withIdentity(human).mutation(api.packages.setCover, { packageId: id, storageId: cover });
    expect(r.ok).toBe(true);
    const doc = (await pkg(t, id))!;
    expect(doc.draft.coverStorageId).toBe(cover);
    expect(doc.fingerprint).toBe(await fingerprint(doc.draft));
    expect(doc.fingerprint).not.toBe(fp);
    const old = await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    expect(old).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
    await t.withIdentity(human).mutation(api.packages.setCover, { packageId: id, storageId: null });
    expect((await pkg(t, id))!.fingerprint).toBe(fp);
  });

  test("after approval the cover cannot change (NOT_READY)", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const as = t.withIdentity(human);
    await as.mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" });
    const r = await as.mutation(api.packages.setCover, { packageId: id, storageId: await image(t) });
    expect(r).toMatchObject({ ok: false, code: "NOT_READY" });
    expect((await pkg(t, id))!.draft.coverStorageId).toBeUndefined();
  });

  test("anonymous, demo, and a real human on a demo package are FORBIDDEN", async () => {
    const t = convexTest(schema, modules);
    const real = await seed(t);
    const demoPkg = await seed(t, { id: "demo-10-2-26", workspace: "demo" });
    const cover = await image(t);
    expect(await t.mutation(api.packages.setCover, { packageId: real.id, storageId: cover })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.withIdentity(demo).mutation(api.packages.setCover, { packageId: demoPkg.id, storageId: cover })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.withIdentity(human).mutation(api.packages.setCover, { packageId: demoPkg.id, storageId: cover })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await pkg(t, real.id))!.fingerprint).toBe(real.fp);
  });

  test("a file that is not an image is refused", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const r = await t.withIdentity(human).mutation(api.packages.setCover, { packageId: id, storageId: await image(t, "text/html") });
    expect(r).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect((await pkg(t, id))!.fingerprint).toBe(fp);
  });
});

describe("packages.coverUploadUrl", () => {
  test("only a signed-in real human gets an upload URL", async () => {
    const t = convexTest(schema, modules);
    expect(await t.withIdentity(human).mutation(api.packages.coverUploadUrl, {})).toEqual(expect.any(String));
    await expect(t.mutation(api.packages.coverUploadUrl, {})).rejects.toThrow();
    await expect(t.withIdentity(demo).mutation(api.packages.coverUploadUrl, {})).rejects.toThrow();
  });
});
