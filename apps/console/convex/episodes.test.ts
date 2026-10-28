// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Plan 6 Task 2: the Episodes page's functions (a signed-in real human only; Hard Rule 9) and the agent's rerun route
// (R7/R9: "July 17 is a rerun of March 13" in Chat). A marked week is never drafted, fetched or asked about again.
const modules = import.meta.glob("./**/*.*s");
const INGEST = "i".repeat(48);
const AGENT = "a".repeat(48);
const DEMO_AGENT = "d".repeat(48);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("INGEST_TOKEN", INGEST);
  vi.stubEnv("AGENT_SUBMIT_TOKEN", AGENT);
  vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO_AGENT);
});
afterEach(() => vi.unstubAllEnvs());

const TRACKS = [
  { hour: 1 as const, position: 1, artist: "A", title: "B", raw: "A - B", closing: true, status: "closing-track" as const },
  { hour: 2 as const, position: 1, artist: "C", title: "D", raw: "C - D", closing: true, status: "closing-track" as const },
];
type Q = { id: string; text: string; kind: "audio" | "date" | "tracklist" | "rerun"; rerunOf?: string };
const episode = (showDate = "2026-07-17", questions: Q[] = []) => ({
  showDate,
  audio: { status: "ready" as const, flags: [] },
  tracklist: { status: "found" as const, tracks: TRACKS },
  notes: { status: "found" as const, text: "private notes" },
  questions,
});
const upsert = (t: T, ep: ReturnType<typeof episode>) => t.mutation(api.ingest.upsert, { token: INGEST, episode: ep });
const row = (t: T, showDate = "2026-07-17") => t.run((ctx) => ctx.db.query("episodes").withIndex("by_showDate", (q) => q.eq("showDate", showDate)).unique());
const statusOf = async (t: T, showDate = "2026-07-17") =>
  (await t.withIdentity(human).query(api.episodes.list, {}))!.episodes.find((e) => e.showDate === showDate)?.status;
const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
  return "no error";
};
const post = (t: T, body: unknown, token = AGENT) =>
  t.fetch("/agent/episodes/rerun", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

describe("episodes.list", () => {
  test("a signed-in real human sees every episode, oldest first, without the notes text; demo and anonymous get null", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-07-17"));
    await upsert(t, episode("2026-03-13"));
    const out = await t.withIdentity(human).query(api.episodes.list, {});
    expect(out!.episodes.map((e) => [e.showDate, e.status, e.packageId])).toEqual([["2026-03-13", "ready-to-draft", "pkg-3-13-26"], ["2026-07-17", "ready-to-draft", "pkg-7-17-26"]]);
    expect(out!.awaitingReview).toBe(0);
    expect(JSON.stringify(out)).not.toContain("private notes");
    expect(await t.query(api.episodes.list, {})).toBeNull();
    expect(await t.withIdentity(demo).query(api.episodes.list, {})).toBeNull();
  });
});

describe("episodes.answer", () => {
  test("answering a question resolves it (R4); only a signed-in real human can", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-07-17", [{ id: "t1", text: "Keep track 3?", kind: "tracklist" }]));
    expect(await statusOf(t)).toBe("question");
    for (const as of [t, t.withIdentity(demo)])
      expect(await errorCode(as.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "t1", answer: "Yes" }))).toBe("FORBIDDEN");
    await t.withIdentity(human).mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "t1", answer: "  Yes, keep it  " });
    expect((await row(t))!.questions[0]).toMatchObject({ answer: "Yes, keep it", answeredAt: expect.any(Number) });
    expect(await statusOf(t)).toBe("ready-to-draft");
  });

  test("an empty or oversized answer, an unknown episode or question are refused", async () => {
    const t = convexTest(schema, modules);
    const h = t.withIdentity(human);
    await upsert(t, episode("2026-07-17", [{ id: "t1", text: "Keep track 3?", kind: "tracklist" }]));
    expect(await errorCode(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "t1", answer: "   " }))).toBe("BAD_INPUT");
    expect(await errorCode(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "t1", answer: "x".repeat(2001) }))).toBe("BAD_INPUT");
    expect(await errorCode(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "nope", answer: "Yes" }))).toBe("NOT_FOUND");
    expect(await errorCode(h.mutation(api.episodes.answer, { showDate: "2026-07-24", questionId: "t1", answer: "Yes" }))).toBe("NOT_FOUND");
  });

  test("rerun question, Yes: the week becomes a rerun of the candidate, source detected, and the question goes", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-03-13")); // the original must exist (review fix 1)
    await upsert(t, episode("2026-07-17", [{ id: "rerun", text: "Is 2026-07-17 a rerun of 2026-03-13?", kind: "rerun", rerunOf: "2026-03-13" }]));
    await t.withIdentity(human).mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "rerun", answer: "yes" });
    expect(await row(t)).toMatchObject({ rerunOf: "2026-03-13", rerunSource: "detected", questions: [] });
    expect(await statusOf(t)).toBe("rerun");
  });

  test("rerun question with an unknown original (R8): Yes needs the date; No declines and is never asked again", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-02-06")); // the original must exist (review fix 1)
    const q: Q = { id: "rerun", text: "Is 2026-07-17 a rerun, and of which show?", kind: "rerun", rerunOf: "" };
    await upsert(t, episode("2026-07-17", [q]));
    const h = t.withIdentity(human);
    expect(await errorCode(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "rerun", answer: "Yes" }))).toBe("BAD_INPUT");
    expect(await errorCode(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "rerun", answer: "Yes", rerunOf: "2026-07-24" }))).toBe("BAD_INPUT");
    expect(await errorCode(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "rerun", answer: "maybe" }))).toBe("BAD_INPUT");
    await h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "rerun", answer: "Yes", rerunOf: "2026-02-06" });
    expect(await row(t)).toMatchObject({ rerunOf: "2026-02-06", rerunSource: "detected" });

    const u = convexTest(schema, modules);
    await upsert(u, episode("2026-07-17", [q]));
    await u.withIdentity(human).mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "rerun", answer: "No" });
    expect(await row(u)).toMatchObject({ rerunDeclined: true, questions: [] });
    expect((await row(u))!.rerunOf).toBeUndefined();
    await upsert(u, episode("2026-07-17", [q]));
    expect((await row(u))!.questions).toEqual([]);
    expect(await statusOf(u)).toBe("ready-to-draft");
  });
});

describe("episodes.markRerun / unmarkRerun", () => {
  test("a signed-in real human marks a week ahead of the scan; the scan keeps it; unmark clears it but keeps rerunDeclined", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-03-13")); // the original must exist (review fix 1)
    const h = t.withIdentity(human);
    await h.mutation(api.episodes.markRerun, { showDate: "2026-07-17", rerunOf: "2026-03-13" });
    expect(await row(t)).toMatchObject({ rerunOf: "2026-03-13", rerunSource: "episodes" });
    await upsert(t, episode("2026-07-17", [{ id: "rerun", text: "Is it a rerun?", kind: "rerun", rerunOf: "2026-03-13" }]));
    expect(await row(t)).toMatchObject({ rerunOf: "2026-03-13", rerunSource: "episodes", questions: [] });
    expect(await statusOf(t)).toBe("rerun");
    expect(await t.mutation(api.ingest.requestDraft, { token: INGEST, showDate: "2026-07-17" })).toEqual({ queued: false, reason: "rerun" });

    await t.run(async (ctx) => ctx.db.patch((await ctx.db.query("episodes").withIndex("by_showDate", (q) => q.eq("showDate", "2026-07-17")).unique())!._id, { rerunDeclined: true }));
    await h.mutation(api.episodes.unmarkRerun, { showDate: "2026-07-17" });
    const r = (await row(t))!;
    expect(r.rerunOf).toBeUndefined();
    expect(r.rerunSource).toBeUndefined();
    expect(r.rerunDeclined).toBe(true);
    expect(await statusOf(t)).toBe("ready-to-draft");
  });

  test("R12: Undo on a detected rerun means 'not a rerun': it declines, so the scan never asks again", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-03-13")); // the original must exist (review fix 1)
    const q: Q = { id: "rerun", text: "Is 2026-07-17 a rerun of 2026-03-13?", kind: "rerun", rerunOf: "2026-03-13" };
    await upsert(t, episode("2026-07-17", [q]));
    const h = t.withIdentity(human);
    await h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "rerun", answer: "Yes" });
    await h.mutation(api.episodes.unmarkRerun, { showDate: "2026-07-17" });
    const r = (await row(t))!;
    expect(r.rerunOf).toBeUndefined();
    expect(r.rerunSource).toBeUndefined();
    expect(r.rerunDeclined).toBe(true);
    await upsert(t, episode("2026-07-17", [q]));
    expect((await row(t))!.questions).toEqual([]);
    expect(await statusOf(t)).toBe("ready-to-draft");
  });

  test("Undo on a chat or Episodes mark just clears it (a later detection may still ask)", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-03-13")); // the original must exist (review fix 1)
    await upsert(t, episode());
    const h = t.withIdentity(human);
    await h.mutation(api.episodes.markRerun, { showDate: "2026-07-17", rerunOf: "2026-03-13" });
    await h.mutation(api.episodes.unmarkRerun, { showDate: "2026-07-17" });
    expect((await row(t))!.rerunDeclined).toBeUndefined();
  });

  test("demo and anonymous callers cannot mark or unmark; bad dates and a later original are refused", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    for (const as of [t, t.withIdentity(demo)]) {
      expect(await errorCode(as.mutation(api.episodes.markRerun, { showDate: "2026-07-17", rerunOf: "2026-03-13" }))).toBe("FORBIDDEN");
      expect(await errorCode(as.mutation(api.episodes.unmarkRerun, { showDate: "2026-07-17" }))).toBe("FORBIDDEN");
    }
    const h = t.withIdentity(human);
    for (const [showDate, rerunOf] of [["2026-07-17", "2026-07-17"], ["2026-07-17", "2026-08-01"], ["2026-02-30", "2026-01-02"], ["2026-07-17", "March 13"]])
      expect(await errorCode(h.mutation(api.episodes.markRerun, { showDate, rerunOf })), `${showDate} ${rerunOf}`).toBe("BAD_INPUT");
    expect((await row(t))!.rerunOf).toBeUndefined();
    expect(await errorCode(h.mutation(api.episodes.unmarkRerun, { showDate: "2026-07-24" }))).toBe("NOT_FOUND");
  });
});

describe("POST /agent/episodes/rerun", () => {
  test("the real agent token marks the week with source chat", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-03-13")); // the original must exist (review fix 1)
    await upsert(t, episode());
    const res = await post(t, { showDate: "2026-07-17", rerunOf: "2026-03-13", rerunSource: "episodes", status: "approved" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ showDate: "2026-07-17", rerunOf: "2026-03-13" });
    expect(await row(t)).toMatchObject({ rerunOf: "2026-03-13", rerunSource: "chat" });
  });

  test("ahead of time: a week not scanned yet gets a row the scan fills in later", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode("2026-03-13")); // the original must exist (review fix 1)
    expect((await post(t, { showDate: "2026-11-06", rerunOf: "2026-03-13" })).status).toBe(200);
    await upsert(t, episode("2026-11-06"));
    expect(await row(t, "2026-11-06")).toMatchObject({ rerunOf: "2026-03-13", rerunSource: "chat", tracklist: { status: "found" } });
  });

  // Hard Rule 9: the demo workspace has no episodes; its token never reaches the real ones.
  test("the demo agent token gets 404 and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, episode());
    const before = await row(t);
    expect((await post(t, { showDate: "2026-07-17", rerunOf: "2026-03-13" }, DEMO_AGENT)).status).toBe(404);
    expect((await post(t, { showDate: "2026-11-06", rerunOf: "2026-03-13" }, DEMO_AGENT)).status).toBe(404);
    expect(await row(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("episodes").collect())).toHaveLength(1);
  });

  test("a wrong token is 401, unset tokens 503, a bad body 400 with plain problems", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, { showDate: "2026-07-17", rerunOf: "2026-03-13" }, INGEST)).status).toBe(401);
    const bad = await post(t, { showDate: "2026-07-17", rerunOf: "2026-08-01" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).problems[0]).toMatch(/earlier/);
    expect((await post(t, { showDate: "2026-07-17" })).status).toBe(400);
    expect((await post(t, "not json")).status).toBe(400);
    vi.stubEnv("AGENT_SUBMIT_TOKEN", "");
    vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", "");
    expect((await post(t, { showDate: "2026-07-17", rerunOf: "2026-03-13" })).status).toBe(503);
    expect(await t.run((ctx) => ctx.db.query("episodes").collect())).toEqual([]);
  });
});

describe("the rerun original must be a real 2026 show that is not itself a rerun (review fix 1)", () => {
  const reason = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { data?: { code?: string; message?: string } }).data;
    }
    return "no error";
  };
  const setupShows = async () => {
    const t = convexTest(schema, modules);
    for (const d of ["2026-03-13", "2026-05-01", "2026-07-17"]) await upsert(t, episode(d));
    await t.withIdentity(human).mutation(api.episodes.markRerun, { showDate: "2026-05-01", rerunOf: "2026-03-13" });
    return t;
  };
  const CASES = [
    ["2026-03-20", "no show on that date"],
    ["2026-05-01", "that show is itself a rerun"],
    ["2025-12-26", "the original must be a 2026 show"],
  ] as const;

  test("markRerun refuses each with a plain reason and writes nothing", async () => {
    const t = await setupShows();
    for (const [rerunOf, message] of CASES)
      expect(await reason(t.withIdentity(human).mutation(api.episodes.markRerun, { showDate: "2026-07-17", rerunOf })), rerunOf).toEqual({ code: "BAD_INPUT", message });
    expect((await row(t))!.rerunOf).toBeUndefined();
  });

  test("answer Yes refuses each, whether the original came from the question or from Tarik", async () => {
    const t = await setupShows();
    const h = t.withIdentity(human);
    for (const [rerunOf, message] of CASES) {
      await upsert(t, episode("2026-07-17", [{ id: "known", text: "Is it a rerun?", kind: "rerun", rerunOf }, { id: "unknown", text: "Of which?", kind: "rerun", rerunOf: "" }]));
      expect(await reason(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "known", answer: "Yes" })), rerunOf).toEqual({ code: "BAD_INPUT", message });
      expect(await reason(h.mutation(api.episodes.answer, { showDate: "2026-07-17", questionId: "unknown", answer: "Yes", rerunOf })), rerunOf).toEqual({ code: "BAD_INPUT", message });
    }
    expect((await row(t))!.rerunOf).toBeUndefined();
  });

  test("the agent route gets 400 with the plain reason", async () => {
    const t = await setupShows();
    for (const [rerunOf, message] of CASES) {
      const res = await post(t, { showDate: "2026-07-17", rerunOf });
      expect(res.status, rerunOf).toBe(400);
      expect((await res.json()).problems).toEqual([message]);
    }
    expect((await row(t))!.rerunOf).toBeUndefined();
  });
});

describe("Connect Google / Connect Dropbox status (Plan 6 Task 3)", () => {
  const sourcesOf = async (t: T) => (await t.withIdentity(human).query(api.episodes.sources, {}))!.map(({ source, state, account }) => ({ source, state, account }));

  test("a signed-in real human records connected (with the account label) and not_connected; the row is replaced whole", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingest.sourceStatus, { token: INGEST, source: "google", state: "needs_reconnect", lastError: "invalid_grant" });
    await t.withIdentity(human).mutation(api.episodes.sourceConnected, { source: "google", account: "tarik@radiomilwaukee.org" });
    await t.withIdentity(human).mutation(api.episodes.sourceConnected, { source: "dropbox", account: "Dropbox account" });
    const rows = await t.withIdentity(human).query(api.episodes.sources, {});
    expect(rows!.find((r) => r.source === "google")).toMatchObject({ state: "connected", account: "tarik@radiomilwaukee.org" });
    expect(rows!.find((r) => r.source === "google")?.lastError).toBeUndefined();
    await t.withIdentity(human).mutation(api.episodes.sourceDisconnected, { source: "google" });
    expect(await sourcesOf(t)).toEqual([
      { source: "dropbox", state: "connected", account: "Dropbox account" },
      { source: "google", state: "not_connected", account: undefined },
    ]);
  });

  test("demo, anonymous and outside accounts are refused; Box has no button, so it can't be set here", async () => {
    const t = convexTest(schema, modules);
    for (const who of [demo, { subject: "x1", email: "someone@gmail.com", emailVerified: true }]) {
      expect(await errorCode(t.withIdentity(who).mutation(api.episodes.sourceConnected, { source: "google", account: "a" }))).toBe("FORBIDDEN");
      expect(await errorCode(t.withIdentity(who).mutation(api.episodes.sourceDisconnected, { source: "dropbox" }))).toBe("FORBIDDEN");
    }
    expect(await errorCode(t.mutation(api.episodes.sourceConnected, { source: "google", account: "a" }))).toBe("FORBIDDEN");
    await expect(t.withIdentity(human).mutation(api.episodes.sourceConnected, { source: "box" as never, account: "a" })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("ingestSources").collect())).toEqual([]);
  });

  test("the account label is capped and must not be empty", async () => {
    const t = convexTest(schema, modules);
    expect(await errorCode(t.withIdentity(human).mutation(api.episodes.sourceConnected, { source: "google", account: "" }))).toBe("BAD_INPUT");
    expect(await errorCode(t.withIdentity(human).mutation(api.episodes.sourceConnected, { source: "google", account: "x".repeat(201) }))).toBe("BAD_INPUT");
  });
});
