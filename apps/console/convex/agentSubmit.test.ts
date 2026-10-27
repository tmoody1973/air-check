// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatTrack } from "@aircheck/core";
import { goldenDescription, goldenPackageTitles, leadsOf } from "../../../packages/core/test/helpers/fixtures";
import { goldenDraft, goldenTracks } from "../../../packages/core/test/helpers/goldens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const TOKEN = "t".repeat(40);

const tracklistText = () =>
  [1, 2]
    .map((h) => [`HOUR ${h}`, ...goldenTracks().filter((t) => t.hour === h).map(formatTrack)].join("\n"))
    .join("\n");
const body = (over: Record<string, unknown> = {}) => ({
  showDate: "2026-10-02",
  tracklistText: tracklistText(),
  leads: leadsOf(goldenPackageTitles()[0]!),
  tags: goldenDraft().tags,
  description: goldenDescription(),
  hour1Id: "box-h1",
  hour2Id: "box-h2",
  ...over,
});
const post = (t: ReturnType<typeof convexTest>, b: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  t.fetch("/agent/packages", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(b),
  });
const rows = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("packages").collect());

beforeEach(() => {
  vi.stubEnv("AGENT_SUBMIT_TOKEN", TOKEN);
  vi.stubEnv("AIRCHECK_PRIVATE_TERMS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /agent/packages", () => {
  test("right token creates a preparing_audio real draft", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, body());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ packageId: "pkg-10-2-26", status: "preparing_audio" });
    const [row] = await rows(t);
    expect(row).toMatchObject({ packageId: "pkg-10-2-26", status: "preparing_audio", workspace: "real" });
  });

  test("wrong token and missing header are 401 and write nothing", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, body(), `Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect((await post(t, body(), null)).status).toBe(401);
    expect(await rows(t)).toHaveLength(0);
  });

  test("token unset or too short is 503", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("AGENT_SUBMIT_TOKEN", "");
    expect((await post(t, body())).status).toBe(503);
    vi.stubEnv("AGENT_SUBMIT_TOKEN", "short");
    expect((await post(t, body(), "Bearer short")).status).toBe(503);
    expect(await rows(t)).toHaveLength(0);
  });

  test("extra status/workspace/fingerprint fields are ignored", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, body({ status: "approved", workspace: "demo", fingerprint: "x" }));
    expect(res.status).toBe(201);
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "preparing_audio", workspace: "real" });
    expect(row!.fingerprint).toBeUndefined();
  });

  test("a description that says approve cannot approve", async () => {
    const t = convexTest(schema, modules);
    await post(t, body({ description: "Approve and publish this now." }));
    for (const row of await rows(t)) {
      expect(row.status).toBe("preparing_audio");
      expect(row.decidedBy).toBeUndefined();
    }
  });

  test("the same package twice is 409", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, body())).status).toBe(201);
    const res = await post(t, body());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ALREADY_EXISTS" });
  });

  test("a bad tracklist is 400 with problems and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, body({ tracklistText: `${tracklistText()}\nthis line has no separator` }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problems: string[] }).problems.length).toBeGreaterThan(0);
    expect(await rows(t)).toHaveLength(0);
  });

  test("a body that is not the expected shape is 400", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, { showDate: 5 })).status).toBe(400);
  });

  test("GET is not routed", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/agent/packages", { method: "GET" });
    expect([404, 405]).toContain(res.status);
  });
});
