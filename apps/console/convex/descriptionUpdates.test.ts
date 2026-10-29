// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { updateFingerprint } from "@aircheck/core";
import { draftRunFor, goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Plan 5c Task 4: updating the description of a show already on Mixcloud. Anyone (the agent or a human) may propose;
// only a signed-in real human approves the exact text (by fingerprint); only the publisher pushes, and only approved.
const modules = import.meta.glob("./**/*.*s");
const HASH = "b".repeat(64);
const AGENT = "t".repeat(40);
const DEMO_AGENT = "d".repeat(40);
const PUB = "p".repeat(48);
const SHOW = "https://www.mixcloud.com/rhythmlab/rlr-10226-tinashe/";
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };
const SOURCES = [{ claim: "Played bass with Ezra Collective", source: "crate: musicbrainz artist lookup" }];
type T = ReturnType<typeof convexTest>;
type UpdateId = Id<"descriptionUpdates">;

/** A package already on Mixcloud: submitted, MP3 attached, then marked succeeded with its receipt. */
async function published(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}, url = SHOW) {
  const draft = goldenDraft({ audio: { hour1Id: "box-h1", hour2Id: "box-h2" }, descriptionSources: SOURCES, ...overrides });
  await t.run((ctx) => ctx.db.insert("runs", draftRunFor(draft)));
  await t.mutation(internal.packages.submit, { draft });
  await t.mutation(internal.packages.attachAudio, { packageId: draft.id, audio: { hour1Id: "box-h1", hour2Id: "box-h2", mp3Sha256: HASH } });
  await setPackage(t, draft.id, { status: "succeeded", result: { url, at: "2026-10-03T12:00:00.000Z" } });
  return draft.id;
}
const setPackage = (t: T, id: string, fields: Record<string, unknown>) =>
  t.run(async (ctx) => {
    const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique();
    await ctx.db.patch(doc!._id, fields as never);
  });
const pkg = (t: T, id: string) => t.run((ctx) => ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique());
const rows = (t: T) => t.run((ctx) => ctx.db.query("descriptionUpdates").collect());
const row = (t: T, id: UpdateId) => t.run((ctx) => ctx.db.get(id));
const setRow = (t: T, id: UpdateId, fields: Record<string, unknown>) => t.run((ctx) => ctx.db.patch(id, fields as never));
const revise = (t: T, body: unknown, token = AGENT) =>
  t.fetch("/agent/packages/revise", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const propose = (t: T, packageId: string, description: string) => t.withIdentity(human).mutation(api.descriptionUpdates.propose, { packageId, description });
async function proposed(t: T, packageId: string, description = "Warm, patient soul for a grey morning.") {
  const r = await propose(t, packageId, description);
  if (!r.ok) throw new Error(r.message);
  return r.id;
}
async function approvedUpdate(t: T, packageId: string, description?: string) {
  const id = await proposed(t, packageId, description);
  const r = await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id, fingerprint: (await row(t, id))!.fingerprint });
  expect(r).toEqual({ ok: true });
  return id;
}
const claim = (t: T) => t.mutation(api.descriptionUpdates.claim, { token: PUB });
const record = (t: T, id: UpdateId, outcome: { status: "pushed" } | { status: "failed"; error: string } | { status: "retry" } | { status: "unconfirmed" } | { status: "unclaim" }) =>
  t.mutation(api.descriptionUpdates.record, { token: PUB, id, outcome });

beforeEach(() => {
  vi.stubEnv("AGENT_SUBMIT_TOKEN", AGENT);
  vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO_AGENT);
  vi.stubEnv("PUBLISHER_TOKEN", PUB);
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
  vi.stubEnv("AIRCHECK_PRIVATE_TERMS", "Jane Secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("descriptionUpdates.propose (a signed-in human)", () => {
  test("on a published package: a proposed row with the live sources and its fingerprint; the package never changes (R10)", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const before = await pkg(t, pid);
    const r = await propose(t, pid, "Warm, patient soul for a grey morning.");
    expect(r).toMatchObject({ ok: true, replaced: false });
    const u = (await rows(t))[0]!;
    expect(u).toMatchObject({ packageId: pid, status: "proposed", proposedBy: "human", attempts: 0, descriptionSources: SOURCES, description: "Warm, patient soul for a grey morning." });
    expect(u.fingerprint).toBe(await updateFingerprint(u.description, SOURCES));
    expect(await pkg(t, pid)).toEqual(before);
  });

  test("the checker's problems come back in plain words (private terms too, never echoed); the live text again is refused", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const r = await propose(t, pid, "Upcoming, thanks to Jane Secret.");
    expect(r).toMatchObject({ ok: false, code: "BAD_INPUT" });
    expect(!r.ok && r.message).toMatch(/upcoming/i);
    expect(!r.ok && r.message).toMatch(/private term/);
    expect(!r.ok && r.message).not.toMatch(/Jane Secret/);
    const same = await propose(t, pid, (await pkg(t, pid))!.draft.description);
    expect(same).toMatchObject({ ok: false, code: "BAD_INPUT", message: "That is already the description on Mixcloud." });
    expect(await rows(t)).toEqual([]);
  });

  test("anonymous, the demo login, and a real human on a demo package are FORBIDDEN; a package not on Mixcloud is NOT_READY", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const demoPid = await published(t, { id: "demo-10-2-26", workspace: "demo" });
    const args = { packageId: pid, description: "New words." };
    expect(await t.mutation(api.descriptionUpdates.propose, args)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.withIdentity(demo).mutation(api.descriptionUpdates.propose, { ...args, packageId: demoPid })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await propose(t, demoPid, "New words.")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    for (const status of ["awaiting_review", "approved", "publishing", "failed", "outcome_unknown", "skipped"]) {
      await setPackage(t, pid, { status });
      expect(await propose(t, pid, "New words."), status).toMatchObject({ ok: false, code: "NOT_READY" });
    }
    expect(await propose(t, "pkg-1-1-26", "New words.")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await rows(t)).toEqual([]);
  });

  test("one open update per package: a new proposal replaces a proposed one; an approved or pushing one refuses it", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const first = await proposed(t, pid, "First words for the show.");
    const second = await propose(t, pid, "Second words for the show.");
    expect(second).toMatchObject({ ok: true, replaced: true });
    expect(await row(t, first)).toBeNull();
    expect((await rows(t)).map((u) => u.description)).toEqual(["Second words for the show."]);
    for (const status of ["approved", "pushing"]) {
      await setRow(t, (await rows(t))[0]!._id, { status });
      const r = await propose(t, pid, "Third words for the show.");
      expect(r, status).toMatchObject({ ok: false, code: "NOT_READY" });
      expect(!r.ok && r.message, status).toMatch(/being sent to Mixcloud/);
    }
    // Finished updates are history, not open: a new proposal is fine after pushed or failed.
    for (const status of ["pushed", "failed"]) {
      await t.run(async (ctx) => { for (const u of await ctx.db.query("descriptionUpdates").collect()) await ctx.db.patch(u._id, { status } as never); });
      expect(await propose(t, pid, `After ${status}, new words.`), status).toMatchObject({ ok: true, replaced: false });
    }
  });
});

describe("descriptionUpdates.approve (Hard Rule 1)", () => {
  test("only a signed-in real human, only with the fingerprint of the text shown, only from proposed", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const id = await proposed(t, pid);
    const fp = (await row(t, id))!.fingerprint;
    expect(await t.mutation(api.descriptionUpdates.approve, { id, fingerprint: fp })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.withIdentity(demo).mutation(api.descriptionUpdates.approve, { id, fingerprint: fp })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id, fingerprint: "f".repeat(64) })).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
    expect((await row(t, id))!.status).toBe("proposed");
    expect(await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id, fingerprint: fp })).toEqual({ ok: true });
    expect(await row(t, id)).toMatchObject({ status: "approved", approvedBy: "dj@radiomilwaukee.org" });
    expect((await row(t, id))!.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id, fingerprint: fp })).toMatchObject({ ok: false, code: "NOT_READY" });
  });

  test("approving a proposal that was replaced is PACKAGE_CHANGED, and the new one stays proposed", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const old = await proposed(t, pid, "First words for the show.");
    const fp = (await row(t, old))!.fingerprint;
    await proposed(t, pid, "Second words for the show.");
    expect(await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id: old, fingerprint: fp })).toMatchObject({ ok: false, code: "PACKAGE_CHANGED" });
    expect((await rows(t)).map((u) => u.status)).toEqual(["proposed"]);
  });

  test("the agent's proposal is never claimed until a human approves it", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const res = await revise(t, { packageId: pid, description: "Agent words about a patient record.", descriptionSources: SOURCES });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { packageId: string; updateId: UpdateId; status: string };
    expect(body).toMatchObject({ packageId: pid, status: "proposed" });
    expect(await row(t, body.updateId)).toMatchObject({ proposedBy: "agent", status: "proposed", descriptionSources: SOURCES });
    for (let i = 0; i < 3; i++) expect(await claim(t)).toBeNull();
    const fp = (await row(t, body.updateId))!.fingerprint;
    expect(fp).toBe(await updateFingerprint("Agent words about a patient record.", SOURCES));
    await t.withIdentity(human).mutation(api.descriptionUpdates.approve, { id: body.updateId, fingerprint: fp });
    expect(await claim(t)).toEqual({ id: body.updateId, packageId: pid, description: "Agent words about a patient record.", showUrl: SHOW });
  });
});

describe("the agent's revise route on a published package (R3)", () => {
  test("checked like any description: a bad one is 400, nothing is proposed", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const r = await revise(t, { packageId: pid, description: "Out today!", descriptionSources: [{ claim: "x" }] });
    expect(r.status).toBe(400);
    expect(await rows(t)).toEqual([]);
  });

  test("an empty or whitespace-only description is 400 'description is empty' (agent and human), nothing is proposed", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    for (const description of ["", "   \n\t"]) {
      const r = await revise(t, { packageId: pid, description });
      expect(r.status, JSON.stringify(description)).toBe(400);
      expect(((await r.json()) as { problems: string[] }).problems).toContain("description is empty");
      expect(await propose(t, pid, description)).toMatchObject({ ok: false, code: "BAD_INPUT", message: expect.stringMatching(/description is empty/) });
    }
    expect(await rows(t)).toEqual([]);
  });

  test("an approved update being sent refuses a new agent proposal (409); a proposed one is replaced", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    await proposed(t, pid);
    expect((await revise(t, { packageId: pid, description: "Agent words, take one." })).status).toBe(201);
    expect((await rows(t)).map((u) => [u.proposedBy, u.status])).toEqual([["agent", "proposed"]]);
    await setRow(t, (await rows(t))[0]!._id, { status: "approved" });
    const r = await revise(t, { packageId: pid, description: "Agent words, take two." });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/being sent to Mixcloud/);
  });

  test("Hard Rule 9: a demo package never gets an update, whatever its status says", async () => {
    const t = convexTest(schema, modules);
    const demoPid = await published(t, { id: "demo-10-2-26", workspace: "demo" });
    const r = await revise(t, { packageId: demoPid, description: "Demo words for the show." }, DEMO_AGENT);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/demo/i);
    // The real token cannot see the demo package at all.
    expect((await revise(t, { packageId: demoPid, description: "Demo words for the show." })).status).toBe(404);
    expect(await rows(t)).toEqual([]);
  });
});

describe("the publisher's side", () => {
  test("claim takes the oldest approved update to pushing with the package's own receipt URL; never proposed ones", async () => {
    const t = convexTest(schema, modules);
    const a = await published(t);
    const b = await published(t, { id: "pkg-10-9-26", showDate: "2026-10-09" }, "https://www.mixcloud.com/rhythmlab/rlr-10926/");
    await proposed(t, b);
    const id = await approvedUpdate(t, a);
    expect(await claim(t)).toEqual({ id, packageId: a, description: "Warm, patient soul for a grey morning.", showUrl: SHOW });
    expect((await row(t, id))!.status).toBe("pushing");
  });

  test("pushed: the page's live description becomes the update; the package draft and fingerprint never change", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const before = await pkg(t, pid);
    const id = await approvedUpdate(t, pid, "New live words for the show.");
    await claim(t);
    await record(t, id, { status: "pushed" });
    expect(await row(t, id)).toMatchObject({ status: "pushed" });
    expect((await row(t, id))!.pushedAt).toMatch(/^\d{4}-/);
    expect(await pkg(t, pid)).toEqual(before);
    const view = await t.withIdentity(human).query(api.descriptionUpdates.forPackage, { packageId: pid });
    expect(view?.live).toMatchObject({ description: "New live words for the show.", descriptionSources: SOURCES });
    expect(view?.live.updatedAt).toMatch(/^\d{4}-/);
    expect(view?.latest).toMatchObject({ id, status: "pushed" });
  });

  test("failed keeps a short code; unclaim (refused key) goes back to approved without counting a try", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const id = await approvedUpdate(t, pid);
    await claim(t);
    await record(t, id, { status: "unclaim" });
    expect(await row(t, id)).toMatchObject({ status: "approved", attempts: 0 });
    await claim(t);
    await record(t, id, { status: "failed", error: "http_404" });
    expect(await row(t, id)).toMatchObject({ status: "failed", error: "http_404" });
    await expect(record(t, id, { status: "pushed" })).rejects.toThrow(/NOT_READY/);
  });

  test("retry goes back to approved and counts the try; the third is failed retries_exhausted", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const id = await approvedUpdate(t, pid);
    for (const expected of ["approved", "approved", "failed"]) {
      expect((await claim(t))?.id).toBe(id);
      await record(t, id, { status: "retry" });
      expect((await row(t, id))!.status).toBe(expected);
    }
    expect(await row(t, id)).toMatchObject({ attempts: 3, error: "retries_exhausted" });
    expect(await claim(t)).toBeNull();
  });

  test("unconfirmed (a 2xx without success) is retried like retry, but the third ends failed unconfirmed, not retries_exhausted", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const id = await approvedUpdate(t, pid);
    for (const expected of ["approved", "approved", "failed"]) {
      expect((await claim(t))?.id).toBe(id);
      await record(t, id, { status: "unconfirmed" });
      expect((await row(t, id))!.status).toBe(expected);
    }
    expect(await row(t, id)).toMatchObject({ attempts: 3, error: "unconfirmed" });
  });

  test("an update left pushing (lost claim answer, or a restart) goes back to approved with the try counted: by reconcile, or by the next claim", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const id = await approvedUpdate(t, pid);
    await claim(t);
    await t.mutation(api.publisher.reconcile, { token: PUB });
    expect(await row(t, id)).toMatchObject({ status: "approved", attempts: 1 });
    await claim(t); // its answer was lost: the next claim hands it out again
    expect((await claim(t))?.id).toBe(id);
    expect(await row(t, id)).toMatchObject({ status: "pushing", attempts: 2 });
    await t.mutation(api.publisher.reconcile, { token: PUB });
    expect(await row(t, id)).toMatchObject({ status: "failed", attempts: 3, error: "retries_exhausted" });
  });

  test("an approved update for a package that is no longer a real published one fails without being handed out", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const id = await approvedUpdate(t, pid);
    await setPackage(t, pid, { workspace: "demo" });
    expect(await claim(t)).toBeNull();
    expect(await row(t, id)).toMatchObject({ status: "failed", error: "not_published" });
  });

  test("every publisher function refuses any other token", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const id = await approvedUpdate(t, pid);
    for (const token of [AGENT, DEMO_AGENT, "m".repeat(48), ""]) {
      await expect(t.mutation(api.descriptionUpdates.claim, { token })).rejects.toThrow(/UNAUTHORIZED/);
      await expect(t.mutation(api.descriptionUpdates.record, { token, id, outcome: { status: "pushed" } })).rejects.toThrow(/UNAUTHORIZED/);
    }
    expect((await row(t, id))!.status).toBe("approved");
  });
});

describe("descriptionUpdates.forPackage", () => {
  test("the live description is the draft until an update is pushed; null for anyone but a signed-in real human", async () => {
    const t = convexTest(schema, modules);
    const pid = await published(t);
    const draft = (await pkg(t, pid))!.draft;
    expect(await t.withIdentity(human).query(api.descriptionUpdates.forPackage, { packageId: pid })).toEqual({
      live: { description: draft.description, descriptionSources: SOURCES }, latest: null,
    });
    const id = await proposed(t, pid);
    const view = await t.withIdentity(human).query(api.descriptionUpdates.forPackage, { packageId: pid });
    expect(view?.live.description).toBe(draft.description);
    expect(view?.latest).toMatchObject({ id, status: "proposed", proposedBy: "human", fingerprint: (await row(t, id))!.fingerprint });
    expect(await t.query(api.descriptionUpdates.forPackage, { packageId: pid })).toBeNull();
    expect(await t.withIdentity(demo).query(api.descriptionUpdates.forPackage, { packageId: pid })).toBeNull();
  });
});
