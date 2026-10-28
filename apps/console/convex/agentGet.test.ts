// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseTracklist } from "@aircheck/core";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Final-review fix: the chat agent reads a package before it revises one (POST /agent/packages/get, the bridge's
// package_get). Read-only, its token's workspace only, and only the fields a rewrite needs.
const modules = import.meta.glob("./**/*.*s");
const AGENT = "t".repeat(40);
const DEMO_AGENT = "d".repeat(40);
const SOURCES = [{ claim: "Played bass with Ezra Collective", source: "crate: musicbrainz artist lookup" }];
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
type T = ReturnType<typeof convexTest>;

const get = (t: T, body: unknown, token = AGENT) =>
  t.fetch("/agent/packages/get", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const setPackage = (t: T, id: string, fields: Record<string, unknown>) =>
  t.run(async (ctx) => {
    const doc = await ctx.db.query("packages").withIndex("by_packageId", (q) => q.eq("packageId", id)).unique();
    await ctx.db.patch(doc!._id, fields as never);
  });
const snapshot = (t: T) =>
  t.run(async (ctx) => ({
    packages: await ctx.db.query("packages").collect(),
    updates: await ctx.db.query("descriptionUpdates").collect(),
    activity: await ctx.db.query("activity").collect(),
  }));

async function awaiting(t: T, overrides: Parameters<typeof goldenDraft>[0] = {}) {
  const draft = goldenDraft({ descriptionSources: SOURCES, coverStorageId: "kg2cover", ...overrides });
  await t.mutation(internal.packages.submit, { draft });
  await t.mutation(internal.packages.attachAudio, { packageId: draft.id, audio: { hour1Id: "box-h1", hour2Id: "box-h2", mp3Sha256: "b".repeat(64) } });
  return draft;
}

beforeEach(() => {
  vi.stubEnv("AGENT_SUBMIT_TOKEN", AGENT);
  vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO_AGENT);
  vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48));
  vi.stubEnv("MEDIA_TOKEN", "m".repeat(48));
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /agent/packages/get", () => {
  test("a package awaiting review: exactly the fields a rewrite needs, the tracklist in the package's spellings", async () => {
    const t = convexTest(schema, modules);
    const draft = await awaiting(t);
    const before = await snapshot(t);
    const res = await get(t, { packageId: draft.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["description", "descriptionSources", "packageId", "showDate", "status", "tags", "title", "tracklistText"]);
    expect(body).toMatchObject({ packageId: draft.id, showDate: draft.showDate, status: "awaiting_review", title: draft.title, tags: draft.tags, description: draft.description, descriptionSources: SOURCES });
    const parsed = parseTracklist(body.tracklistText);
    expect(parsed.bad).toEqual([]);
    expect(parsed.tracks.map((x) => [x.hour, x.artist])).toEqual(draft.tracks.map((x) => [x.hour, x.artist]));
    // Never the cover, audio ids or hashes, the fingerprint, or who decided.
    expect(JSON.stringify(body)).not.toMatch(/kg2cover|box-h1|bbbb|fingerprint|decidedBy/);
    expect(await snapshot(t)).toEqual(before); // read-only: no writes, no activity rows
  });

  test("a show on Mixcloud: the live description (latest pushed update) and the open update's status; never the result URL", async () => {
    const t = convexTest(schema, modules);
    const draft = await awaiting(t);
    await setPackage(t, draft.id, { status: "succeeded", decidedBy: "dj@radiomilwaukee.org", result: { url: "https://www.mixcloud.com/rhythmlab/x/?utm=secret", at: "2026-10-03T12:00:00.000Z" } });
    const plain = await (await get(t, { packageId: draft.id })).json();
    expect(plain).toMatchObject({ status: "succeeded", description: draft.description, descriptionSources: SOURCES });
    expect(plain).not.toHaveProperty("openUpdate");
    await t.run((ctx) =>
      ctx.db.insert("descriptionUpdates", { packageId: draft.id, description: "Pushed words.", status: "pushed", proposedBy: "human", fingerprint: "f1", attempts: 1, pushedAt: "2026-10-04T00:00:00.000Z" }),
    );
    const r = await t.withIdentity(human).mutation(api.descriptionUpdates.propose, { packageId: draft.id, description: "Proposed words." });
    expect(r.ok).toBe(true);
    const body = await (await get(t, { packageId: draft.id })).json();
    expect(body).toMatchObject({ status: "succeeded", description: "Pushed words.", openUpdate: "proposed" });
    expect(body).not.toHaveProperty("descriptionSources"); // the pushed update carried none
    expect(JSON.stringify(body)).not.toMatch(/utm=secret|mixcloud\.com|radiomilwaukee|Proposed words/);
  });

  test("another workspace's package answers like a missing one; the demo token reads the demo workspace", async () => {
    const t = convexTest(schema, modules);
    const real = await awaiting(t);
    const demo = await awaiting(t, { id: "demo-10-2-26", workspace: "demo" });
    expect((await get(t, { packageId: real.id }, DEMO_AGENT)).status).toBe(404);
    expect((await get(t, { packageId: demo.id })).status).toBe(404);
    expect((await get(t, { packageId: "pkg-1-1-26" })).status).toBe(404);
    expect(await (await get(t, { packageId: demo.id }, DEMO_AGENT)).json()).toMatchObject({ packageId: demo.id });
  });

  test("a bad body is 400; a bad token is 401", async () => {
    const t = convexTest(schema, modules);
    expect((await get(t, {})).status).toBe(400);
    expect((await get(t, { packageId: 7 })).status).toBe(400);
    expect((await get(t, { packageId: "pkg-10-2-26" }, "x".repeat(40))).status).toBe(401);
  });
});
