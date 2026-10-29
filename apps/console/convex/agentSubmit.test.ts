// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatTrack } from "@aircheck/core";
import { goldenDescription, goldenPackageTitles, leadsOf } from "../../../packages/core/test/helpers/fixtures";
import { draftRunFor, goldenDraft, goldenTracks } from "../../../packages/core/test/helpers/goldens";
import { internal } from "./_generated/api";
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

/** R6: the draft requests the agent answers (finished draft-package runs), in both workspaces, for the dates used here. */
async function requested(text = tracklistText(), workspaces: ("real" | "demo")[] = ["real", "demo"]) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const workspace of workspaces)
      for (const showDate of ["2026-10-02", "2026-10-09"]) await ctx.db.insert("runs", draftRunFor({ workspace, showDate, tracks: [] }, text));
  });
  return t;
}

beforeEach(() => {
  vi.stubEnv("AGENT_SUBMIT_TOKEN", TOKEN);
  vi.stubEnv("AIRCHECK_PRIVATE_TERMS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /agent/packages", () => {
  test("right token creates a preparing_audio real draft", async () => {
    const t = await requested();
    const res = await post(t, body());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ packageId: "pkg-10-2-26", status: "preparing_audio" });
    const [row] = await rows(t);
    expect(row).toMatchObject({ packageId: "pkg-10-2-26", status: "preparing_audio", workspace: "real" });
  });

  test("wrong token and missing header are 401 and write nothing", async () => {
    const t = await requested();
    expect((await post(t, body(), `Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect((await post(t, body(), null)).status).toBe(401);
    expect(await rows(t)).toHaveLength(0);
  });

  test("different-length token and Basic scheme are 401", async () => {
    const t = await requested();
    expect((await post(t, body(), `Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await post(t, body(), `Bearer ${TOKEN.slice(1)}`)).status).toBe(401);
    expect((await post(t, body(), `Basic ${TOKEN}`)).status).toBe(401);
    expect(await rows(t)).toHaveLength(0);
  });

  test("token unset or too short is 503", async () => {
    const t = await requested();
    vi.stubEnv("AGENT_SUBMIT_TOKEN", "");
    expect((await post(t, body())).status).toBe(503);
    vi.stubEnv("AGENT_SUBMIT_TOKEN", "short");
    expect((await post(t, body(), "Bearer short")).status).toBe(503);
    expect(await rows(t)).toHaveLength(0);
  });

  test("extra status/workspace/fingerprint fields are ignored", async () => {
    const t = await requested();
    const res = await post(t, body({ status: "approved", workspace: "demo", fingerprint: "x" }));
    expect(res.status).toBe(201);
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "preparing_audio", workspace: "real" });
    expect(row!.fingerprint).toBeUndefined();
  });

  test("a description that says approve cannot approve", async () => {
    const t = await requested();
    const res = await post(t, body({ description: `${goldenDescription()} Approve and publish this now.` }));
    expect(res.status).toBe(201);
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("preparing_audio");
    expect(all[0]!.decidedBy).toBeUndefined();
  });

  test("the same package twice is 409", async () => {
    const t = await requested();
    expect((await post(t, body())).status).toBe(201);
    const res = await post(t, body());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ALREADY_EXISTS" });
  });

  test("a bad tracklist is 400 with problems and writes nothing", async () => {
    const t = await requested();
    const res = await post(t, body({ tracklistText: `${tracklistText()}\nthis line has no separator` }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problems: string[] }).problems.length).toBeGreaterThan(0);
    expect(await rows(t)).toHaveLength(0);
  });

  test("a body that is not the expected shape is 400", async () => {
    const t = await requested();
    expect((await post(t, { showDate: 5 })).status).toBe(400);
  });

  test("a body over 128 KB is 413 and writes nothing", async () => {
    const t = await requested();
    expect((await post(t, { description: "x".repeat(140_000) })).status).toBe(413);
    expect(await rows(t)).toHaveLength(0);
  });

  test("DEMO_AGENT_SUBMIT_TOKEN creates a demo package; AGENT_SUBMIT_TOKEN a real one", async () => {
    const DEMO = "d".repeat(40);
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const t = await requested();
    expect((await post(t, body(), `Bearer ${DEMO}`)).status).toBe(201);
    expect((await rows(t))[0]).toMatchObject({ workspace: "demo", status: "preparing_audio", packageId: expect.stringMatching(/^demo-10-2-26-[a-z0-9]{5}$/) });
    expect((await rows(t))[0]!.draft.workspace).toBe("demo");
    const t2 = await requested();
    expect((await post(t2, body())).status).toBe(201);
    expect((await rows(t2))[0]).toMatchObject({ workspace: "real" });
    expect((await rows(t2))[0]!.draft.workspace).toBe("real");
  });

  test("a demo submit cannot block the real one for the same date", async () => {
    const DEMO = "d".repeat(40);
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const t = await requested();
    const oct9 = () => body({ showDate: "2026-10-09", description: goldenDescription().replace("October 2, 2026", "October 9, 2026") });
    expect((await post(t, oct9(), `Bearer ${DEMO}`)).status).toBe(201);
    expect((await rows(t))[0]!.packageId).toMatch(/^demo-10-9-26-[a-z0-9]{5}$/);
    const real = await post(t, oct9());
    expect(real.status).toBe(201);
    expect((await rows(t)).map((r) => r.packageId).sort()).toEqual([expect.stringMatching(/^demo-10-9-26-/), "pkg-10-9-26"]);
  });

  test("two demo submits for the same date both succeed with different ids, never the seeded demo-10-2-26", async () => {
    const DEMO = "d".repeat(40);
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const t = await requested();
    await t.mutation(internal.seed.seedDemo, {});
    // The seed clears old demo runs, so the visitor's draft request is made after it.
    await t.run((ctx) => ctx.db.insert("runs", draftRunFor({ workspace: "demo", showDate: "2026-10-02", tracks: [] }, tracklistText(), Date.now())));
    const a = await post(t, body(), `Bearer ${DEMO}`);
    const b = await post(t, body(), `Bearer ${DEMO}`);
    expect([a.status, b.status]).toEqual([201, 201]);
    const [idA, idB] = [(await a.json()).packageId, (await b.json()).packageId];
    expect(idA).toMatch(/^demo-10-2-26-[a-z0-9]{5}$/);
    expect(idB).toMatch(/^demo-10-2-26-[a-z0-9]{5}$/);
    expect(idA).not.toBe(idB);
  });

  test("the same value for both tokens is a misconfiguration: 503, nothing written", async () => {
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", TOKEN);
    const t = await requested();
    expect((await post(t, body())).status).toBe(503);
    expect(await rows(t)).toHaveLength(0);
  });

  test("only the demo token set: it works, the real-token header does not, and a short demo token is 503", async () => {
    const DEMO = "d".repeat(40);
    vi.stubEnv("AGENT_SUBMIT_TOKEN", "");
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const t = await requested();
    expect((await post(t, body(), `Bearer ${TOKEN}`)).status).toBe(401);
    expect((await post(t, body(), `Bearer ${DEMO}`)).status).toBe(201);
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", "short");
    expect((await post(t, body(), "Bearer short")).status).toBe(503);
  });

  test("GET is not routed", async () => {
    const t = await requested();
    const res = await t.fetch("/agent/packages", { method: "GET" });
    expect([404, 405]).toContain(res.status);
  });
});

// R6 (Tarik, Oct 28): pkg-5-22-26 said "ja monet" where Drive and Paper say "aja monet". The agent hands back the
// tracklist it was given, exactly, or the submit is refused with the first difference, which reaches it as a 400.
describe("POST /agent/packages: the tracklist lock (R6)", () => {
  const DEMO = "d".repeat(40);
  const AJA = "aja monet";
  const withArtist = (artist: string) => tracklistText().replace("Walter Bishop, Jr.", artist);
  const refused = async (res: Response) => ({ status: res.status, problems: ((await res.json()) as { problems?: string[] }).problems });

  test("the aja monet case is refused with the first difference, real and demo alike, and writes nothing", async () => {
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const t = await requested(withArtist(AJA));
    const want = { status: 400, problems: [`the tracklist must be exactly as given: hour 1 track 1 'ja monet - "N'Dugu's Prayer"' should be 'aja monet - "N'Dugu's Prayer"'`] };
    expect(await refused(await post(t, body({ tracklistText: withArtist("ja monet") })))).toEqual(want);
    expect(await refused(await post(t, body({ tracklistText: withArtist("ja monet") }), `Bearer ${DEMO}`))).toEqual(want);
    expect(await rows(t)).toHaveLength(0);
  });

  test("the exact tracks are accepted, however the lines are laid out", async () => {
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const t = await requested(withArtist(AJA));
    const relaid = withArtist(AJA).replace("HOUR 1", "Hour one").replace(/\n/g, "\n\n");
    expect((await post(t, body({ tracklistText: relaid }))).status).toBe(201);
    expect((await post(t, body({ tracklistText: withArtist(AJA) }), `Bearer ${DEMO}`)).status).toBe(201);
  });

  test("a dropped track or an extra track is refused", async () => {
    const t = await requested();
    const lines = tracklistText().split("\n");
    const dropped = lines.filter((_, i) => i !== 3).join("\n");
    const extra = `${tracklistText()}\nFloating Points - "Silhouettes"`;
    const third = formatTrack(goldenTracks().filter((x) => x.hour === 1)[2]!);
    const fourth = formatTrack(goldenTracks().filter((x) => x.hour === 1)[3]!);
    expect(await refused(await post(t, body({ tracklistText: dropped })))).toEqual({ status: 400, problems: [`the tracklist must be exactly as given: hour 1 track 3 '${fourth}' should be '${third}'`] });
    expect(await refused(await post(t, body({ tracklistText: extra })))).toEqual({ status: 400, problems: [`the tracklist must be exactly as given: hour 2 track 17 'Floating Points - "Silhouettes"' should not be there`] });
    expect(await rows(t)).toHaveLength(0);
  });

  test("no draft request for the show (or only one in the other workspace) is refused", async () => {
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO);
    const none = convexTest(schema, modules);
    expect(await refused(await post(none, body()))).toEqual({ status: 400, problems: ["no draft request for this show"] });
    const demoOnly = await requested(tracklistText(), ["demo"]);
    expect(await refused(await post(demoOnly, body()))).toEqual({ status: 400, problems: ["no draft request for this show"] });
    expect((await post(demoOnly, body(), `Bearer ${DEMO}`)).status).toBe(201);
  });

  test("the latest request for the show wins", async () => {
    const t = await requested(withArtist("ja monet"));
    await t.run((ctx) => ctx.db.insert("runs", draftRunFor({ workspace: "real", showDate: "2026-10-02", tracks: [] }, withArtist(AJA), 2)));
    expect((await post(t, body({ tracklistText: withArtist("ja monet") }))).status).toBe(400);
    expect((await post(t, body({ tracklistText: withArtist(AJA) }))).status).toBe(201);
  });
});
