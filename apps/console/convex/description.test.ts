// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fingerprint, toSections } from "@aircheck/core";
import { draftRunFor, goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Plan 5c Task 3: the description changes before approval, by a human (packages.editDescription) or the agent
// (POST /agent/packages/revise). Either way the package re-fingerprints and only a human approves the new text.
const modules = import.meta.glob("./**/*.*s");
const HASH = "b".repeat(64);
const TOKEN = "t".repeat(40);
const DEMO = "d".repeat(40);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };
const SOURCES = [{ claim: "Played bass with Ezra Collective", source: "crate: musicbrainz artist lookup" }];
type T = ReturnType<typeof convexTest>;

async function seed(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const draft = goldenDraft({ audio: { hour1Id: "box-h1", hour2Id: "box-h2" }, ...overrides });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  const rec = await t.mutation(internal.packages.attachAudio, { packageId: draft.id, audio: { hour1Id: "box-h1", hour2Id: "box-h2", mp3Sha256: HASH } });
  return { id: draft.id, fp: rec.fingerprint as string };
}
const pkg = (t: T, id: string) => t.run((ctx) => ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique());
const setStatus = (t: T, id: string, status: string) =>
  t.run(async (ctx) => {
    const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique();
    await ctx.db.patch(doc!._id, { status: status as never });
  });
const revise = (t: T, body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  t.fetch("/agent/packages/revise", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("AGENT_SUBMIT_TOKEN", TOKEN);
  vi.stubEnv("AIRCHECK_PRIVATE_TERMS", "Jane Secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("packages.editDescription", () => {
  test("a human edits while awaiting review: re-fingerprints, keeps the sources, and the old fingerprint cannot approve", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t, { descriptionSources: SOURCES });
    const r = await t.withIdentity(human).mutation(api.packages.editDescription, { packageId: id, description: "Warm, patient soul." });
    expect(r).toMatchObject({ ok: true, record: { status: "awaiting_review" } });
    const doc = (await pkg(t, id))!;
    expect(doc.draft.description).toBe("Warm, patient soul.");
    expect(doc.draft.descriptionSources).toEqual(SOURCES);
    expect(doc.draft.audio.mp3Sha256).toBe(HASH);
    expect(doc.fingerprint).toBe(await fingerprint(doc.draft));
    expect(await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" })).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
    expect(await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: doc.fingerprint!, decision: "approve" })).toMatchObject({ ok: true });
  });

  test("the checker refuses with plain reasons, including the server's private terms; nothing changes", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const r = await t.withIdentity(human).mutation(api.packages.editDescription, { packageId: id, description: "Upcoming, thanks to Jane Secret." });
    expect(r).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect(!r.ok && r.message).toMatch(/upcoming/i);
    expect(!r.ok && r.message).toMatch(/private term/);
    expect(!r.ok && r.message).not.toMatch(/Jane Secret/);
    expect((await pkg(t, id))!.fingerprint).toBe(fp);
  });

  test("anonymous, demo, and a real human on a demo package are FORBIDDEN; after approval NOT_READY", async () => {
    const t = convexTest(schema, modules);
    const real = await seed(t);
    const demoPkg = await seed(t, { id: "demo-10-2-26", workspace: "demo" });
    const args = (packageId: string) => ({ packageId, description: "New words." });
    expect(await t.mutation(api.packages.editDescription, args(real.id))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.withIdentity(demo).mutation(api.packages.editDescription, args(demoPkg.id))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.withIdentity(human).mutation(api.packages.editDescription, args(demoPkg.id))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await t.withIdentity(human).mutation(api.packages.decide, { packageId: real.id, fingerprint: real.fp, decision: "approve" });
    expect(await t.withIdentity(human).mutation(api.packages.editDescription, args(real.id))).toMatchObject({ ok: false, code: "NOT_READY" });
    expect((await pkg(t, real.id))!.draft.description).toBe(goldenDraft().description);
  });
});

// R7: a host fixes a track on the package page (the agent can't: R6). Same gate as the description.
describe("packages.editTracklist", () => {
  const EDITED = 'HOUR 1\nMichael Kiwanuka - "Cold Little Heart"\nTinashe - "Nasty"\nHOUR 2\nBicep - "Glue"\nKaytranada - "Lite Spots"\nHiatus Kaiyote - "Nakamarra"';
  const edit = (as: ReturnType<T["withIdentity"]> | T, packageId: string, text = EDITED) => as.mutation(api.packages.editTracklist, { packageId, text });

  test("a human edits while awaiting review: the tracks (and Mixcloud sections) change, it re-fingerprints, an activity row is written", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const before = (await t.run((ctx) => ctx.db.query("activity").collect())).length;
    expect(await edit(t.withIdentity(human), id)).toMatchObject({ ok: true, record: { status: "awaiting_review" } });
    const doc = (await pkg(t, id))!;
    expect(doc.status).toBe("awaiting_review");
    expect(toSections(doc.draft.tracks).map((x) => x.artist)).toEqual(["Michael Kiwanuka", "Tinashe", "Bicep", "Kaytranada", "Hiatus Kaiyote"]);
    expect(doc.fingerprint).toBe(await fingerprint(doc.draft));
    expect(doc.fingerprint).not.toBe(fp);
    expect((await t.run((ctx) => ctx.db.query("activity").collect())).length).toBe(before + 1);
    expect(await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" })).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
  });

  test("a bad line, or a title lead gone from the new tracklist, is refused with plain reasons; nothing changes", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const bad = await edit(t.withIdentity(human), id, `${EDITED}\nno dash here`);
    expect(bad).toMatchObject({ ok: false, code: "BAD_INPUT", message: 'tracklist line 8 (no-separator): "no dash here"' });
    const lead = await edit(t.withIdentity(human), id, EDITED.replace("Bicep", "Floating Points"));
    expect(lead).toMatchObject({ ok: false, code: "BAD_INPUT", message: "title artist not in the tracklist: Bicep" });
    const long = await edit(t.withIdentity(human), id, `${EDITED}\n${"#".repeat(50_001)}`);
    expect(long).toMatchObject({ ok: false, code: "BAD_INPUT", message: "the tracklist is over 50,000 characters" });
    expect((await pkg(t, id))!.fingerprint).toBe(fp);
  });

  test("anonymous, demo, and a real human on a demo package are FORBIDDEN; once approved, or before the MP3, NOT_READY", async () => {
    const t = convexTest(schema, modules);
    const real = await seed(t);
    const demoPkg = await seed(t, { id: "demo-10-2-26", workspace: "demo" });
    expect(await edit(t, real.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await edit(t.withIdentity(demo), demoPkg.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await edit(t.withIdentity(human), demoPkg.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await t.withIdentity(human).mutation(api.packages.decide, { packageId: real.id, fingerprint: real.fp, decision: "approve" });
    expect(await edit(t.withIdentity(human), real.id)).toMatchObject({ ok: false, code: "NOT_READY" });
    const u = convexTest(schema, modules);
    const draft = goldenDraft({ audio: { hour1Id: "pending", hour2Id: "pending" } });
    await u.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
    await u.mutation(internal.packages.submit, { draft });
    expect(await edit(u.withIdentity(human), draft.id)).toMatchObject({ ok: false, code: "NOT_READY" });
    expect((await pkg(t, real.id))!.draft.tracks).toEqual(goldenDraft().tracks);
  });
});

describe("POST /agent/packages/revise", () => {
  test("replaces description and sources together, keeps the MP3, stays in review, and needs a new human approve", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t, { descriptionSources: [{ claim: "old", source: "old" }] });
    const res = await revise(t, { packageId: id, description: "Sampha and friends, unhurried.", descriptionSources: SOURCES, status: "approved", title: "X" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ packageId: id, status: "awaiting_review" });
    const doc = (await pkg(t, id))!;
    expect(doc.status).toBe("awaiting_review");
    expect(doc.decidedBy).toBeUndefined();
    expect(doc.draft).toMatchObject({ description: "Sampha and friends, unhurried.", descriptionSources: SOURCES, title: goldenDraft().title });
    expect(doc.draft.audio.mp3Sha256).toBe(HASH);
    expect(doc.fingerprint).toBe(await fingerprint(doc.draft));
    expect(await t.withIdentity(human).mutation(api.packages.decide, { packageId: id, fingerprint: fp, decision: "approve" })).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
  });

  test("no sources in the revision means none on the draft", async () => {
    const t = convexTest(schema, modules);
    const { id } = await seed(t, { descriptionSources: SOURCES });
    expect((await revise(t, { packageId: id, description: "Plain words." })).status).toBe(200);
    expect((await pkg(t, id))!.draft.descriptionSources).toBeUndefined();
  });

  test("a bad description or bad sources is 400 with problems, and nothing changes", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    const bad = await revise(t, { packageId: id, description: "Out next week." });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { problems: string[] }).problems.join(" ")).toMatch(/next week/);
    const src = await revise(t, { packageId: id, description: "Fine words.", descriptionSources: [{ claim: "", source: "x" }] });
    expect(src.status).toBe(400);
    expect(await revise(t, { packageId: id })).toHaveProperty("status", 400);
    expect((await pkg(t, id))!.fingerprint).toBe(fp);
  });

  test("a token revises only its own workspace: the other's package is 404, same as a missing one", async () => {
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const t = convexTest(schema, modules);
    const real = await seed(t);
    const demoPkg = await seed(t, { id: "demo-10-2-26-abcde", workspace: "demo" });
    expect((await revise(t, { packageId: real.id, description: "Words." }, `Bearer ${DEMO}`)).status).toBe(404);
    expect((await revise(t, { packageId: demoPkg.id, description: "Words." })).status).toBe(404);
    expect((await revise(t, { packageId: "pkg-1-1-26", description: "Words." })).status).toBe(404);
    expect((await pkg(t, real.id))!.fingerprint).toBe(real.fp);
    expect((await revise(t, { packageId: demoPkg.id, description: "Words." }, `Bearer ${DEMO}`)).status).toBe(200);
  });

  // A published package gets a proposed update instead (Task 4, descriptionUpdates.test.ts).
  test("anything else not awaiting review is 409 with a plain reason", async () => {
    const t = convexTest(schema, modules);
    const { id, fp } = await seed(t);
    for (const status of ["approved", "publishing", "skipped", "failed", "outcome_unknown", "preparing_audio"]) {
      await setStatus(t, id, status);
      const r = await revise(t, { packageId: id, description: "Words." });
      expect(r.status, status).toBe(409);
      expect(((await r.json()) as { error: string }).error, status).toMatch(/\w+ \w+/);
    }
    expect((await pkg(t, id))!.fingerprint).toBe(fp);
  });

  test("wrong or missing token is 401; unset is 503", async () => {
    const t = convexTest(schema, modules);
    const { id } = await seed(t);
    expect((await revise(t, { packageId: id, description: "Words." }, `Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect((await revise(t, { packageId: id, description: "Words." }, null)).status).toBe(401);
    vi.stubEnv("AGENT_SUBMIT_TOKEN", "");
    expect((await revise(t, { packageId: id, description: "Words." })).status).toBe(503);
  });
});
