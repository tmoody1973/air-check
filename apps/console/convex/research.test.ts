// @vitest-environment edge-runtime
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { deepDiveQueries, INFOBOX_FIELDS, LIMITS } from "@aircheck/core";
import { api, internal } from "./_generated/api";
import { RESEARCH_BODY_BYTES } from "./agentSubmit";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = (sid = "s1") => ({ subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo", sid });
const AGENT = "a".repeat(48);
const DEMO_AGENT = "d".repeat(48);
const RELAY = "r".repeat(48);
const DATE = "2026-10-30";

// H1.1, H1.2, H1.3 (closing); H2.1, H2.2 (closing).
const TRACKLIST = ["HOUR 1", "Alfa Mist – Organic Rust", "Nala Sinephro – Space 1", "Kokoroko – Abusey Junction", "HOUR 2", "Yussef Dayes – Black Classical Music", "Moses Boyd – Stranger Than Fiction"].join("\n");

const SOURCES = {
  S1aaaa: { url: "https://label-a.example/organic-rust", host: "label-a.example", title: "Organic Rust", via: "tavily", text: "Organic Rust is out 2026-10-10 on Label A. Recorded in London." },
  S2bbbb: { url: "https://musicbrainz.org/release/1", host: "musicbrainz.org", title: "Organic Rust", via: "crate:musicbrainz_search", text: "Organic Rust, 2026-10-10, Label A" },
};
const detail = (text = "Recorded in London.", id = "S1aaaa") => ({ kind: "detail", text, sources: [{ id }] });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 30, 15)); // Oct 30, 10:00 in Chicago
  vi.stubEnv("AGENT_SUBMIT_TOKEN", AGENT);
  vi.stubEnv("DEMO_AGENT_SUBMIT_TOKEN", DEMO_AGENT);
  vi.stubEnv("RELAY_TOKEN", RELAY);
  // Plan 7 Task 5: a done real verify job schedules play-history lookups. No test reaches the network.
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in tests");
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const post = (t: T, path: string, body: unknown, token = AGENT) =>
  t.fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const submit = async (t: T, body: Record<string, unknown>, token = AGENT) => {
  const res = await post(t, "/agent/research", { sources: {}, ...body }, token);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
};
const job = (t: T, jobId: string) => t.run((ctx) => ctx.db.query("research").withIndex("by_jobId", (q) => q.eq("jobId", jobId)).unique());
const entries = (t: T, jobId: string) => t.run((ctx) => ctx.db.query("researchEntries").withIndex("by_jobId_key", (q) => q.eq("jobId", jobId)).collect());
const runs = (t: T) => t.run((ctx) => ctx.db.query("runs").collect());
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string; message?: string } }).data ?? { code: String(e) };
  }
  return { code: "no error" };
};
const startNotes = (t: T, as: ReturnType<T["withIdentity"]> = t.withIdentity(human), over: Record<string, unknown> = {}) =>
  as.mutation(api.research.startShowNotes, { showDate: DATE, tracklistText: TRACKLIST, angles: true, ...over });
/** The relay picks the run up, then reports it finished; the scheduled research hook runs. */
const finishRun = async (t: T, runId: string, status: "completed" | "cancelled" | "failed" = "completed") => {
  await t.mutation(api.relay.started, { token: RELAY, runId, hermesRunId: `h-${runId}` });
  await t.mutation(api.relay.finished, { token: RELAY, runId, status });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
};
/** Saves every researchable key of a TRACKLIST job (facts per track key), then the run ends: the job is done. */
const finishDone = async (t: T, jobId: string, runId: string, facts: Record<string, string> = {}) => {
  for (const key of ["H1.1", "H1.2", "H2.1"]) await submit(t, { job: jobId, key, claims: [detail(facts[key] ?? `${key} fact.`)], sources: SOURCES });
  for (const h of [1, 2]) {
    await submit(t, { job: jobId, key: `H${h}.intro`, intro: "An hour built on London jazz.", sources: SOURCES });
    await submit(t, { job: jobId, key: `H${h}.threads`, threads: [], sources: SOURCES });
  }
  await finishRun(t, runId);
};
const episode = (over: Record<string, unknown> = {}) => ({
  showDate: DATE,
  audio: { status: "none" as const, flags: [] },
  tracklist: {
    status: "found" as const,
    tracks: [
      { hour: 1, position: 1, artist: "Alfa Mist", title: "Organic Rust", raw: "Alfa Mist – Organic Rust", closing: false, status: "confirmed" },
      { hour: 1, position: 2, artist: "Kokoroko", title: "Abusey Junction", raw: "Kokoroko – Abusey Junction", closing: true, status: "closing-track" },
      { hour: 2, position: 1, artist: "Yussef Dayes", title: "Black Classical Music", raw: "Yussef Dayes – Black Classical Music", closing: false, status: "confirmed" },
      { hour: 2, position: 2, artist: "Moses Boyd", title: "Stranger Than Fiction", raw: "Moses Boyd – Stranger Than Fiction", closing: true, status: "closing-track" },
    ],
  },
  notes: {
    status: "found" as const,
    text: ["## 1. Alfa Mist – \"Organic Rust\"", "Out Oct 10 on Label A.", "## 2. Kokoroko – \"Abusey Junction\"", "A closing note.", "## 1. Yussef Dayes – \"Black Classical Music\"", "Debut album."].join("\n"),
  },
  questions: [],
  scannedAt: 1,
  ...over,
});

describe("start", () => {
  test("show notes from typed text: keyed tracks, closing marked, one research run with the job id", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t);
    expect(jobId).toMatch(/^rj-[0-9a-z]{6}$/);
    const j = (await job(t, jobId))!;
    expect(j).toMatchObject({ workspace: "real", kind: "show-notes", showDate: DATE, status: "queued", angles: true, runIds: [runId], continuations: 0 });
    expect(j.tracks!.map((x) => `${x.key}${x.closing ? "*" : ""}`)).toEqual(["H1.1", "H1.2", "H1.3*", "H2.1", "H2.2*"]);
    const all = await runs(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ runId, kind: "research", jobId, status: "queued", source: "live" });
    expect(all[0]!.input).toContain("H1.3 · closing track, skipped");
    expect(all[0]!.input).toContain(jobId);
    // Oct 29 prefetch: the relay gets the job id, so it can start the bridge's first searches without the model.
    expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([expect.objectContaining({ runId, kind: "research", jobId })]);
  });

  test("a tracklist with an unreadable line or an empty hour is refused", async () => {
    const t = convexTest(schema, modules);
    const bad = await errorOf(startNotes(t, undefined, { tracklistText: `${TRACKLIST}\nno separator here` }));
    expect(bad).toMatchObject({ code: "BAD_INPUT" });
    expect(bad.message).toMatch(/line 8/);
    const empty = await errorOf(startNotes(t, undefined, { tracklistText: "HOUR 1\nAlfa Mist – Organic Rust\nHOUR 2" }));
    expect(empty).toMatchObject({ code: "BAD_INPUT", message: "Hour 2 has no tracks." });
    expect(await runs(t)).toEqual([]);
  });

  test("a second start for the same show while one is running is refused; a stuck one is superseded", async () => {
    const t = convexTest(schema, modules);
    const first = await startNotes(t);
    expect(await errorOf(startNotes(t))).toMatchObject({ code: "BAD_INPUT", message: `Show notes for ${DATE} are already being written.` });
    vi.setSystemTime(Date.UTC(2026, 9, 30, 22)); // 7 hours later: the open run is stuck
    const second = await startNotes(t);
    expect((await job(t, first.jobId))!.status).toBe("stopped");
    expect((await job(t, second.jobId))!.status).toBe("queued");
  });

  test("verify from Paper notes: lines numbered, closing lines marked", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const { jobId, runId } = await t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } });
    const j = (await job(t, jobId))!;
    expect(j.notesSource).toBe("paper");
    expect(j.lines!.map((l) => `${l.id}${l.closing ? "*" : ""}`)).toEqual(["L1", "L2", "L3*", "L4*", "L5", "L6"]);
    const input = (await runs(t)).find((r) => r.runId === runId)!.input!;
    expect(input).toContain("L2");
    expect(input).not.toContain("A closing note.");
  });

  test("verify with no tracklist anywhere is refused", async () => {
    const t = convexTest(schema, modules);
    expect(await errorOf(t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "pasted", text: "Some notes." } }))).toMatchObject({
      code: "BAD_INPUT", message: "Add the tracklist first, so closing tracks are skipped.",
    });
  });

  test("deep dive on a closing track, by key or by name, is refused", async () => {
    const t = convexTest(schema, modules);
    await startNotes(t);
    const as = t.withIdentity(human);
    const msg = "That's the closing track of hour 1. Closing tracks are never researched.";
    expect(await errorOf(as.mutation(api.research.startDeepDive, { type: "release", name: "Abusey Junction", showDate: DATE, fromKey: "H1.3" }))).toMatchObject({ message: msg });
    expect(await errorOf(as.mutation(api.research.startDeepDive, { type: "artist", name: "kokoroko", showDate: DATE }))).toMatchObject({ message: msg });
    const ok = await as.mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist", showDate: DATE, fromKey: "H1.1" });
    expect((await job(t, ok.jobId))!.subject).toEqual({ type: "artist", name: "Alfa Mist", fromKey: "H1.1" });
  });

  test("M7: one active deep dive per subject per workspace, whatever the show date", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    await as.mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist" });
    expect(await errorOf(as.mutation(api.research.startDeepDive, { type: "artist", name: "alfa mist", showDate: DATE }))).toMatchObject({ message: "A deep dive on alfa mist is already being written." });
    await as.mutation(api.research.startDeepDive, { type: "artist", name: "Kokoroko", showDate: DATE });
  });

  test("signed out is refused", async () => {
    const t = convexTest(schema, modules);
    expect(await errorOf(t.mutation(api.research.startShowNotes, { showDate: DATE, tracklistText: TRACKLIST, angles: true }))).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("POST /agent/research (submitEntry)", () => {
  test("a good block saves judged claims, moves the job to running and returns verify counts", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const r = await submit(t, {
      job: jobId, key: "H1.1",
      claims: [detail(), { kind: "release-date", text: "Released on 2026-10-10.", value: "2026-10-10", sources: [{ id: "S2bbbb" }] }],
      angle: "What connects this record to the London scene?",
      sources: SOURCES,
    });
    expect(r).toEqual({ status: 200, data: { saved: "H1.1", claims: 2, verify: 1, dropped: [] } });
    expect((await job(t, jobId))!.status).toBe("running");
    const [e] = await entries(t, jobId);
    expect(e).toMatchObject({ key: "H1.1", block: "track", angle: "What connects this record to the London scene?" });
    expect(e!.claims.map((c) => c.status)).toEqual(["sourced", "could-not-verify"]);
    expect(e!.claims[0]!.sources[0]).toMatchObject({ url: "https://label-a.example/organic-rust", matched: true });
  });

  test("a block citing 40 sources of 8,000 characters each saves, even at JSON's worst 6 bytes a character; past the route's cap is 413", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const ids = Array.from({ length: LIMITS.sourcesPerBlock }, (_, i) => `S${String(i).padStart(5, "0")}`);
    const worst = "\u0001"; // a control character: JSON writes it as \u0001, six bytes
    const sources = Object.fromEntries(ids.map((id, i) => [id, {
      url: `https://example.org/${i}/${"a".repeat(2_000)}`, host: "example.org", title: worst.repeat(200), via: "tavily", text: worst.repeat(LIMITS.sourceText),
    }]));
    const claims = Array.from({ length: 10 }, (_, i) => ({ kind: "detail", text: "Recorded in London.", sources: ids.slice(i * 4, i * 4 + 4).map((id) => ({ id })) }));
    const body = { job: jobId, key: "H1.1", claims, sources };
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeGreaterThan(1_900_000);
    expect(await submit(t, body)).toMatchObject({ status: 200, data: { saved: "H1.1", claims: 10 } });
    const res = await post(t, "/agent/research", { ...body, pad: "x".repeat(RESEARCH_BODY_BYTES) });
    expect(res.status).toBe(413);
  });

  test("Oct 29: on a long page a date counts only near the block's track (Alfa Mist, Organic Rust)", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const filler = "Other records in the catalog. ".repeat(90);
    const page = (text: string) => ({ url: "https://news.example/a", host: "news.example", title: "News", via: "tavily", text });
    const claim = { kind: "release-date", text: "Released on 2026-10-10.", value: "2026-10-10", sources: [{ id: "S3cccc" }] };
    await submit(t, { job: jobId, key: "H1.1", claims: [claim], sources: { S3cccc: page(`Alfa Mist news. ${filler} A reissue out October 10, 2026.`) } });
    expect((await entries(t, jobId))[0]!.claims[0]!.sources[0]!.matched).toBe(false);
    await submit(t, { job: jobId, key: "H1.1", claims: [claim], sources: { S3cccc: page(`${filler} Organic Rust is out October 10, 2026.`) } });
    expect((await entries(t, jobId))[0]!.claims[0]!.sources[0]!.matched).toBe(true);
  });

  test("a closing track's key is 409 with the plain sentence", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    expect(await submit(t, { job: jobId, key: "H1.3", claims: [detail()], sources: SOURCES })).toEqual({
      status: 409, data: { error: "H1.3 is a closing track. Closing tracks are never researched." },
    });
    expect(await entries(t, jobId)).toEqual([]);
    expect((await job(t, jobId))!.lastProblems).toEqual(["H1.3 is a closing track. Closing tracks are never researched."]);
  });

  test("talk in an angle is 400 and kept as the latest problem; a field on the wrong key is 400 naming it", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const talk = await submit(t, { job: jobId, key: "H1.1", claims: [detail()], angle: "Stay tuned for this one", sources: SOURCES });
    expect(talk.status).toBe(400);
    expect(String((talk.data.problems as string[])[0])).toMatch(/on-air talk/);
    expect((await job(t, jobId))!.lastProblems).toEqual(talk.data.problems);
    const wrong = await submit(t, { job: jobId, key: "H1.intro", claims: [detail()], sources: SOURCES });
    expect(wrong).toMatchObject({ status: 400, data: { problems: ["H1.intro does not take claims."] } });
    expect(await entries(t, jobId)).toEqual([]);
  });

  test("Oct 29 (Tarik): a sourceless fact in show notes or a deep dive is kept as could-not-verify, 'No source found.'", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const r = await submit(t, { job: jobId, key: "H1.2", claims: [detail(), { kind: "bio", text: "Born in Leeds.", sources: [] }], sources: SOURCES });
    expect(r).toEqual({ status: 200, data: { saved: "H1.2", claims: 2, verify: 1, dropped: [] } });
    expect((await entries(t, jobId))[0]!.claims[1]).toEqual({ kind: "bio", text: "Born in Leeds.", status: "could-not-verify", sources: [], check: "No source found." });
    const dive = await t.withIdentity(human).mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist" });
    expect(await submit(t, { job: dive.jobId, key: "brief", claims: [{ kind: "bio", text: "Born in London.", sources: [] }], sources: SOURCES })).toMatchObject({ status: 200, data: { claims: 1, verify: 1, dropped: [] } });
  });

  test("Oct 30 (decision 023): a brief is an article: up to 28 section facts, 8 infobox rows from the allowlist and 3 connections", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.withIdentity(human).mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist", showDate: DATE });
    const fact = (kind: string, i: number) => ({ kind, text: `Alfa Mist fact ${i}.`, sources: [{ id: "S1aaaa" }] });
    const kinds = ["lead", "origins", "career", "sound", "records", "legacy"];
    const facts = Array.from({ length: LIMITS.briefFactsMax }, (_, i) => fact(kinds[i % kinds.length]!, i));
    const fields = ["Origin", "Years active", "Genres", "Labels", "Members", "Founded", "Released", "Producer"];
    const infobox = fields.map((f) => ({ kind: "infobox", text: f, value: "London", sources: [{ id: "S1aaaa" }] }));
    const connects = ["H1.1", "H1.2", "H2.1"].map((key) => ({ kind: "connection", text: "Same scene.", value: key, sources: [{ id: "S1aaaa" }] }));
    const full = [...facts, ...infobox, ...connects];
    expect(full).toHaveLength(LIMITS.briefClaims);
    // The deep dive above has no tracklist; give it this show's tracks to connect to.
    await t.run(async (ctx) => {
      const j = await ctx.db.query("research").withIndex("by_jobId", (q) => q.eq("jobId", jobId)).unique();
      const tracks = [1, 2].map((h) => ({ key: `H${h === 1 ? "1.1" : "2.1"}`, hour: h as 1 | 2, position: 1, artist: "A", title: "B", closing: false }));
      await ctx.db.patch(j!._id, { tracks: [...tracks, { key: "H1.2", hour: 1, position: 2, artist: "C", title: "D", closing: false }] });
    });
    expect(await submit(t, { job: jobId, key: "brief", claims: full, sources: SOURCES })).toMatchObject({ status: 200, data: { claims: LIMITS.briefClaims } });
    const tooMany = await submit(t, { job: jobId, key: "brief", claims: [...full, fact("career", 99)], sources: SOURCES });
    expect(tooMany.data.problems).toEqual(expect.arrayContaining([`At most ${LIMITS.briefClaims} claims in the brief.`, `A brief has at most ${LIMITS.briefFactsMax} section facts.`]));
    const nine = await submit(t, { job: jobId, key: "brief", claims: [...facts.slice(0, 10), ...infobox, { ...infobox[0]! }], sources: SOURCES });
    expect(nine.data.problems).toEqual([`A brief has at most ${LIMITS.infoboxMax} infobox rows.`]);
    const odd = await submit(t, { job: jobId, key: "brief", claims: [{ kind: "infobox", text: "Shoe size", value: "10", sources: [] }, { kind: "infobox", text: "Origin", sources: [] }], sources: SOURCES });
    expect(odd.data.problems).toEqual([
      `An infobox row's text is one of: ${INFOBOX_FIELDS.join(", ")}.`,
      "An infobox row needs a value.",
    ]);
    // A show-notes track keeps its 12, and takes no infobox row.
    const notes = await startNotes(t);
    const track = await submit(t, { job: notes.jobId, key: "H1.1", claims: [...Array.from({ length: 13 }, (_, i) => detail(`Fact ${i}.`)), { kind: "infobox", text: "Origin", value: "London", sources: [] }], sources: SOURCES });
    expect(track.data.problems).toEqual(["At most 12 claims in one block.", "Only a deep dive's brief takes infobox rows."]);
  });

  test("a pre-air check still drops a sourceless claim and names it: checking a line needs a source", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const { jobId } = await t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } });
    const r = await submit(t, { job: jobId, key: "L2", claims: [detail(), { kind: "bio", text: "Born in Leeds.", sources: [] }], sources: SOURCES });
    expect(r).toEqual({ status: 200, data: { saved: "L2", claims: 1, verify: 0, dropped: ["Claim 2 has no source. A pre-air check needs one."] } });
  });

  test("a claim's value and a source's says pass the same text checks as the claim (I1)", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const bad = await submit(t, { job: jobId, key: "H1.1", claims: [{ kind: "label", text: "On Label A.", value: "Stay tuned! https://evil.example/", sources: [{ id: "S1aaaa" }] }], sources: SOURCES });
    expect(bad.status).toBe(400);
    expect((bad.data.problems as string[])[0]).toMatch(/^Claim 1 value: /);
    const long = await submit(t, { job: jobId, key: "H1.1", claims: [{ kind: "label", text: "On Label A.", value: "Label A", sources: [{ id: "S1aaaa", says: "x".repeat(20_000) }] }], sources: SOURCES });
    expect(long.status).toBe(400);
    expect((long.data.problems as string[])[0]).toMatch(/^Claim 1 source 1 says: Too long/);
    expect(await entries(t, jobId)).toEqual([]);
  });

  test("a cited id with no source sent is 400", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const r = await submit(t, { job: jobId, key: "H1.2", claims: [detail("Recorded in London.", "S9zzzz")], sources: SOURCES });
    expect(r).toMatchObject({ status: 400, data: { problems: ["S9zzzz is not a source Air Check gave you; cite only [S…] ids from your search results."] } });
  });

  test("fields the agent adds (artist, title, url) are never stored", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const r = await submit(t, {
      job: jobId, key: "H1.1", artist: "Xyzzy Artist", title: "Xyzzy Title", url: "https://xyzzy.example",
      claims: [{ ...detail(), artist: "Xyzzy Artist", sources: [{ id: "S1aaaa", url: "https://xyzzy.example" }] }],
      sources: SOURCES,
    });
    expect(r.status).toBe(200);
    expect(JSON.stringify(await entries(t, jobId))).not.toMatch(/xyzzy/i);
  });

  test("unknown job or another workspace's token is 404; a job not running is 409", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    expect((await submit(t, { job: "rj-nope00", key: "H1.1", claims: [detail()], sources: SOURCES })).status).toBe(404);
    expect((await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES }, DEMO_AGENT)).status).toBe(404);
    await t.withIdentity(human).mutation(api.research.takeOver, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers); // the queued run was cancelled at once: the job ends stopped
    expect(await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES })).toEqual({ status: 409, data: { error: "This research job is not running." } });
  });

  test("Take over: the next submit is 409 'Tarik took over; stop now.' and the run is asked to stop", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t);
    await t.mutation(api.relay.started, { token: RELAY, runId, hermesRunId: "h1" });
    await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES });
    await t.withIdentity(human).mutation(api.research.takeOver, { jobId });
    expect((await job(t, jobId))!.status).toBe("taken-over");
    expect((await runs(t))[0]).toMatchObject({ status: "stopping", stopRequested: true });
    expect(await submit(t, { job: jobId, key: "H1.2", claims: [detail()], sources: SOURCES })).toEqual({ status: 409, data: { error: "Tarik took over; stop now." } });
    expect((await entries(t, jobId)).map((e) => e.key)).toEqual(["H1.1"]);
    // The relay reports the stop: the job ends stopped and nothing more is queued.
    await t.mutation(api.relay.finished, { token: RELAY, runId, status: "cancelled" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await job(t, jobId))!.status).toBe("stopped");
    expect(await runs(t)).toHaveLength(1);
  });

  test("the bad body shapes are 400", async () => {
    const t = convexTest(schema, modules);
    expect((await submit(t, { key: "H1.1" })).status).toBe(400);
    const { jobId } = await startNotes(t);
    expect((await submit(t, { job: jobId, key: "H1.1", claims: [{ kind: "gossip", text: "x", sources: [] }] })).status).toBe(400);
  });
});

describe("Tarik's edits are kept", () => {
  test("a submit, a Resume and a continuation leave an edit; Regenerate asks first", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const { jobId, runId } = await startNotes(t);
    await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES });
    await as.mutation(api.research.editEntry, { jobId, key: "H1.1", text: "My own words." });
    expect(await submit(t, { job: jobId, key: "H1.1", claims: [detail("Something else.")], sources: SOURCES })).toEqual({
      status: 409, data: { error: "H1.1 was edited by Tarik; skip it." },
    });
    // A continuation: keys left and progress, so one more run, without the edited key.
    await finishRun(t, runId);
    const cont = (await runs(t)).find((r) => r.runId !== runId)!;
    expect(cont.input).not.toMatch(/^H1\.1 /m);
    expect(cont.input).toMatch(/^H1\.2 /m);
    // Resume after a Take over: still not the edited key.
    await as.mutation(api.research.takeOver, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { runId: resumed } = await as.mutation(api.research.resume, { jobId });
    expect((await runs(t)).find((r) => r.runId === resumed)!.input).not.toMatch(/^H1\.1 /m);
    const e = (await entries(t, jobId)).find((x) => x.key === "H1.1")!;
    expect(e.edited?.text).toBe("My own words.");
    expect(e.claims[0]!.text).toBe("Recorded in London.");
    // Regenerate: refused while the job runs, then asks before overwriting the edit.
    await as.mutation(api.research.takeOver, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await errorOf(as.mutation(api.research.regenerate, { jobId, key: "H1.1", overwriteEdit: false }))).toEqual({
      code: "HAS_EDITS", message: "This block has your edits. Regenerate anyway?",
    });
    expect(await errorOf(as.mutation(api.research.regenerate, { jobId, key: "H1.3", overwriteEdit: true }))).toMatchObject({
      message: "H1.3 is a closing track. Closing tracks are never researched.",
    });
    const { runId: regen } = await as.mutation(api.research.regenerate, { jobId, key: "H1.1", overwriteEdit: true });
    expect((await runs(t)).find((r) => r.runId === regen)!.input).toMatch(/^H1\.1 /m);
    // M4: the edit stays until the regenerated block is actually saved; another key is still refused.
    expect((await entries(t, jobId)).find((x) => x.key === "H1.1")!.edited?.text).toBe("My own words.");
    expect((await submit(t, { job: jobId, key: "H1.1", claims: [detail("Fresh fact.")], sources: SOURCES })).status).toBe(200);
    const after = (await entries(t, jobId)).find((x) => x.key === "H1.1")!;
    expect(after.edited).toBeUndefined();
    expect(after.claims[0]!.text).toBe("Fresh fact.");
  });

  test("I2: an edit made while a Regenerate runs survives the agent's save of that block", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const { jobId, runId } = await startNotes(t);
    await finishDone(t, jobId, runId);
    // Regenerate an un-edited block, then Tarik edits it while the run goes.
    await as.mutation(api.research.regenerate, { jobId, key: "H1.1", overwriteEdit: false });
    await as.mutation(api.research.editEntry, { jobId, key: "H1.1", text: "Written during the run." });
    expect(await submit(t, { job: jobId, key: "H1.1", claims: [detail("Fresh fact.")], sources: SOURCES })).toEqual({
      status: 409, data: { error: "H1.1 was edited by Tarik; skip it." },
    });
    expect((await entries(t, jobId)).find((x) => x.key === "H1.1")!.edited?.text).toBe("Written during the run.");
    // Confirmed over an older edit, then a newer edit during the run: the newer one is kept too.
    await as.mutation(api.research.takeOver, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await as.mutation(api.research.regenerate, { jobId, key: "H1.1", overwriteEdit: true });
    await as.mutation(api.research.editEntry, { jobId, key: "H1.1", text: "Second thoughts." });
    expect((await submit(t, { job: jobId, key: "H1.1", claims: [detail("Fresh fact.")], sources: SOURCES })).status).toBe(409);
    expect((await entries(t, jobId)).find((x) => x.key === "H1.1")!.edited?.text).toBe("Second thoughts.");
  });

  test("supplied notes and private marks survive an agent resubmit", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const { jobId } = await startNotes(t);
    await as.mutation(api.research.setSuppliedNote, { jobId, key: "H1.2", note: "From the label's one-sheet." });
    await as.mutation(api.research.setPrivate, { jobId, key: "H1.2", private: true });
    await submit(t, { job: jobId, key: "H1.2", claims: [detail()], sources: SOURCES });
    const e = (await entries(t, jobId)).find((x) => x.key === "H1.2")!;
    expect(e).toMatchObject({ suppliedNote: "From the label's one-sheet.", private: { by: "tarik" } });
    expect(e.claims).toHaveLength(1);
    expect(await errorOf(as.mutation(api.research.setSuppliedNote, { jobId, key: "H1.2", note: "x".repeat(2001) }))).toMatchObject({ code: "BAD_INPUT" });
  });
});

describe("continuations", () => {
  test("keys left and progress queue one more run, up to 3; a run that saved nothing ends the job failed", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t);
    let current = runId;
    for (let i = 1; i <= 3; i++) {
      await submit(t, { job: jobId, key: `H1.${i === 3 ? "intro" : i}`, ...(i === 3 ? { intro: "An hour built on London jazz." } : { claims: [detail()] }), sources: SOURCES });
      await finishRun(t, current);
      const j = (await job(t, jobId))!;
      expect(j.continuations).toBe(i);
      expect(j.runIds).toHaveLength(i + 1);
      current = j.runIds.at(-1)!;
    }
    await submit(t, { job: jobId, key: "H2.1", claims: [detail()], sources: SOURCES });
    await finishRun(t, current);
    const j = (await job(t, jobId))!;
    expect(j.status).toBe("stopped");
    expect(j.lastProblems).toEqual(["Stopped after 3 continuations; Resume to finish."]);
    expect(j.runIds).toHaveLength(4);

    const t2 = convexTest(schema, modules);
    const s = await startNotes(t2);
    await finishRun(t2, s.runId);
    expect((await job(t2, s.jobId))!).toMatchObject({ status: "failed", runIds: [s.runId] });
  });

  test("a follow-up run that saves nothing after earlier runs saved blocks ends the job stopped, not failed (Oct 30)", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t);
    await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES });
    await finishRun(t, runId);
    const follow = (await job(t, jobId))!.runIds.at(-1)!;
    await finishRun(t, follow);
    expect((await job(t, jobId))!).toMatchObject({ status: "stopped", lastProblems: ["The last run saved nothing; Resume to finish."] });
  });

  test("all keys done ends the job done", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t);
    for (const key of ["H1.1", "H1.2", "H2.1"]) await submit(t, { job: jobId, key, claims: [detail()], sources: SOURCES });
    for (const h of [1, 2]) {
      await submit(t, { job: jobId, key: `H${h}.intro`, intro: "An hour built on London jazz.", sources: SOURCES });
      await submit(t, { job: jobId, key: `H${h}.threads`, threads: [{ kind: "thread", text: "Both came up through Tomorrow's Warriors.", sources: [{ id: "S1aaaa" }] }], sources: SOURCES });
    }
    await finishRun(t, runId);
    const j = (await job(t, jobId))!;
    expect(j.status).toBe("done");
    expect(j.finishedAt).toBeTypeOf("number");
    const view = await t.withIdentity(human).query(api.research.get, { jobId });
    expect(view!.progress).toEqual({ done: 7, total: 7 });
  });

  test("a demo continuation that cannot run live ends the job stopped with the plain reason", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t, t.withIdentity(demo()));
    expect((await job(t, jobId))!.workspace).toBe("demo");
    await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES }, DEMO_AGENT);
    vi.stubEnv("DEMO_LIVE_RUNS_PER_DAY", "1");
    await finishRun(t, runId);
    expect((await job(t, jobId))!).toMatchObject({ status: "stopped", lastProblems: ["The demo's live limit for today is reached."], runIds: [runId] });
  });
});

describe("progress estimate", () => {
  test("secondsLeft is paced from the current run's start, not the job's creation", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const { jobId } = await startNotes(t);
    await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES });
    await as.mutation(api.research.takeOver, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.setSystemTime(Date.now() + 86_400_000); // a day later
    await as.mutation(api.research.resume, { jobId });
    vi.setSystemTime(Date.now() + 60_000);
    await submit(t, { job: jobId, key: "H1.2", claims: [detail()], sources: SOURCES });
    // 7 blocks to research, 2 done, 1 of them in this run's first minute: about 5 minutes left.
    expect((await as.query(api.research.get, { jobId }))!.secondsLeft).toBe(300);
  });
});

describe("retarget", () => {
  test("swapped tracks move their entries; a removed track goes stale; a new closing track shows no entry", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const first = ["HOUR 1", "Alfa Mist – Organic Rust", "Nala Sinephro – Space 1", "Kokoroko – Abusey Junction", "HOUR 2", "Yussef Dayes – Black Classical Music", "Shabaka – Afrikan Culture", "Moses Boyd – Stranger Than Fiction"].join("\n");
    const { jobId } = await startNotes(t, as, { tracklistText: first });
    await submit(t, { job: jobId, key: "H1.1", claims: [detail("About Alfa Mist.")], sources: SOURCES });
    await submit(t, { job: jobId, key: "H1.2", claims: [detail("About Nala Sinephro.")], sources: SOURCES });
    await submit(t, { job: jobId, key: "H2.1", claims: [detail("About Yussef Dayes.")], sources: SOURCES });
    await submit(t, { job: jobId, key: "H2.2", claims: [detail("About Shabaka.")], sources: SOURCES });
    await as.mutation(api.research.takeOver, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // Nala and Alfa swap; Shabaka is gone; Yussef Dayes now closes hour 2.
    const next = ["HOUR 1", "Nala Sinephro – Space 1", "Alfa Mist – Organic Rust", "Kokoroko – Abusey Junction", "HOUR 2", "Moses Boyd – Stranger Than Fiction", "Yussef Dayes – Black Classical Music"].join("\n");
    await as.mutation(api.research.retarget, { jobId, tracklistText: next });
    const view = (await as.query(api.research.get, { jobId }))!;
    const text = (key: string) => view.entries.find((e) => e.key === key)?.claims[0]?.text;
    expect(text("H1.1")).toBe("About Nala Sinephro.");
    expect(text("H1.2")).toBe("About Alfa Mist.");
    expect(text("H2.2")).toBeUndefined();
    expect(view.entries.map((e) => e.key).sort()).toEqual(["H1.1", "H1.2"]);
    const stale = (await entries(t, jobId)).filter((e) => e.stale);
    expect(stale.map((e) => e.claims[0]!.text).sort()).toEqual(["About Shabaka.", "About Yussef Dayes."]);
  });
});

describe("leak guard (Review Focus 5)", () => {
  test("research.ts never mentions the packages or descriptionUpdates tables", () => {
    const text = readFileSync(new URL("./research.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/packages|descriptionUpdates/);
  });

  test("notesForDraft omits private blocks and embargoed tracks (dated and undated); a cleared embargo brings the track back", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const dated = await t.run((ctx) => ctx.db.insert("releases", { workspace: "real", artist: "Alfa Mist", title: "Organic Rust", embargo: { until: "2026-11-07" } }));
    await t.run((ctx) => ctx.db.insert("releases", { workspace: "real", artist: "Nala Sinephro", title: "Space 1", embargo: { until: null } }));
    const { jobId, runId } = await startNotes(t);
    await as.mutation(api.research.setPrivate, { jobId, key: "H2.1", private: true });
    await finishDone(t, jobId, runId, { "H1.1": "Alfa fact.", "H1.2": "Nala fact.", "H2.1": "Yussef fact." });
    expect((await job(t, jobId))!.status).toBe("done");
    const notes = await as.query(api.research.notesForDraft, { showDate: DATE });
    expect(notes).not.toMatch(/Alfa|Nala|Yussef/);
    await as.mutation(api.radar.setEmbargo, { releaseId: dated, embargo: null });
    expect(await as.query(api.research.notesForDraft, { showDate: DATE })).toMatch(/Alfa fact\./);
    expect(JSON.stringify(await entries(t, jobId))).not.toMatch(/embargo/);
  });

  test("R9: notesForDraft and verify from Air Check notes use the newest done job, never a newer stopped one", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const a = await startNotes(t);
    await finishDone(t, a.jobId, a.runId, { "H1.1": "Done job fact." });
    const b = await startNotes(t);
    await submit(t, { job: b.jobId, key: "H1.1", claims: [detail("Stopped job fact.")], sources: SOURCES });
    await as.mutation(api.research.takeOver, { jobId: b.jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await job(t, b.jobId))!.status).toBe("stopped");
    const notes = await as.query(api.research.notesForDraft, { showDate: DATE });
    expect(notes).toMatch(/Done job fact\./);
    expect(notes).not.toMatch(/Stopped job fact/);
    const v = await as.mutation(api.research.startVerify, { showDate: DATE, notes: { from: "air-check" } });
    const lines = (await job(t, v.jobId))!.lines!.map((l) => l.text).join("\n");
    expect(lines).toMatch(/Done job fact\./);
    expect(lines).not.toMatch(/Stopped job fact/);
  });

  test("M5: verify from Air Check notes numbers lines against that job's own tracks", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const a = await startNotes(t);
    await finishDone(t, a.jobId, a.runId);
    // A newer show-notes job for the same date with a different tracklist (Kokoroko no longer closes hour 1).
    const other = ["HOUR 1", "Kokoroko – Abusey Junction", "Ezra Collective – Victory Dance", "HOUR 2", "Moses Boyd – Stranger Than Fiction"].join("\n");
    const b = await startNotes(t, as, { tracklistText: other });
    await as.mutation(api.research.takeOver, { jobId: b.jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const v = await as.mutation(api.research.startVerify, { showDate: DATE, notes: { from: "air-check" } });
    expect((await job(t, v.jobId))!.tracks!.map((x) => x.key + (x.closing ? "*" : ""))).toEqual(["H1.1", "H1.2", "H1.3*", "H2.1", "H2.2*"]);
  });

  test("the export marks an embargoed track private", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("releases", { workspace: "real", artist: "Alfa Mist", title: "Organic Rust", embargo: { until: null } }));
    const { jobId } = await startNotes(t);
    await submit(t, { job: jobId, key: "H1.1", claims: [detail("Alfa fact.")], sources: SOURCES });
    const md = await t.withIdentity(human).query(api.research.exportMarkdown, { jobId });
    expect(md).toMatch(/PRIVATE · embargoed/);
    expect(await t.withIdentity(demo()).query(api.research.exportMarkdown, { jobId })).toBeNull();
  });
});

describe("search caps (POST /agent/search-usage)", () => {
  const usage = async (t: T, body: unknown, token = AGENT) => {
    const res = await post(t, "/agent/search-usage", body, token);
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };

  test("100 real and 20 demo per Chicago day, separate per workspace, then allowed: false without counting; the next day starts again", async () => {
    const t = convexTest(schema, modules);
    for (let i = 1; i <= 100; i++) expect((await usage(t, { query: `q${i}` })).data).toEqual({ allowed: true, used: i, cap: 100 });
    expect((await usage(t, { query: "one more" })).data).toEqual({ allowed: false, used: 100, cap: 100 });
    for (let i = 1; i <= 20; i++) await usage(t, { query: `d${i}` }, DEMO_AGENT);
    expect((await usage(t, { query: "one more" }, DEMO_AGENT)).data).toEqual({ allowed: false, used: 20, cap: 20 });
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 100, cap: 100 });
    expect(await t.withIdentity(demo()).query(api.research.searchUsage, {})).toEqual({ used: 20, cap: 20 });
    vi.setSystemTime(Date.UTC(2026, 9, 31, 5, 30)); // 00:30 Oct 31 in Chicago
    expect((await usage(t, { query: "new day" })).data).toEqual({ allowed: true, used: 1, cap: 100 });
  });

  test("a query naming an active embargo is refused without counting and names nothing", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("releases", { workspace: "real", artist: "Alfa Mist", title: "Organic Rust", embargo: { until: "2026-11-07" } }));
    expect(await usage(t, { query: "Alfa Mist Organic Rust release date" })).toEqual({ status: 200, data: { allowed: false, embargoed: true } });
    expect((await usage(t, { query: "Alfa Mist Organic Rust" }, DEMO_AGENT)).data).toMatchObject({ allowed: true }); // other workspace
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 0, cap: 100 });
  });

  test("Apple Music lookups count apart from web search (60 real per day)", async () => {
    const t = convexTest(schema, modules);
    expect((await usage(t, { query: "Organic Rust", source: "apple_music" })).data).toEqual({ allowed: true, used: 1, cap: 60 });
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 0, cap: 100 });
    expect((await usage(t, { query: "x", source: "spotify" })).status).toBe(400);
    expect((await usage(t, {})).status).toBe(400);
  });

  test("countSearch is concurrency-safe: parallel calls never pass the cap", async () => {
    const t = convexTest(schema, modules);
    const all = await Promise.all(Array.from({ length: 22 }, (_, i) => t.mutation(internal.research.countSearch, { workspace: "demo", query: `q${i}` })));
    expect(all.filter((r) => r.allowed)).toHaveLength(20);
  });
});

describe("first searches (Oct 29 prefetch: POST /agent/research-prefetch and /agent/search-done)", () => {
  const call = async (t: T, path: string, body: unknown, token = AGENT) => {
    const res = await post(t, path, body, token);
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
  const plan = (t: T, job: string, token = AGENT) => call(t, "/agent/research-prefetch", { job }, token);
  const q = (artist: string, title: string) => `Tell me about this artist and release ${artist} - "${title}"`;
  const q2 = (artist: string, title: string) => `${artist} - "${title}" interviews, reviews and samples`;

  test("lists each track left to research with its first-search query; closing tracks, done tracks, intros and threads are left out", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    expect(await plan(t, jobId)).toEqual({
      status: 200,
      data: {
        tracks: [
          { key: "H1.1", query: q("Alfa Mist", "Organic Rust"), query2: q2("Alfa Mist", "Organic Rust") },
          { key: "H1.2", query: q("Nala Sinephro", "Space 1"), query2: q2("Nala Sinephro", "Space 1") },
          { key: "H2.1", query: q("Yussef Dayes", "Black Classical Music"), query2: q2("Yussef Dayes", "Black Classical Music") },
        ],
        embargoed: [],
      },
    });
    await submit(t, { job: jobId, key: "H1.1", claims: [detail()], sources: SOURCES });
    expect(((await plan(t, jobId)).data.tracks as { key: string }[]).map((x) => x.key)).toEqual(["H1.2", "H2.1"]);
    // It only reads: no search is counted by asking.
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 0, cap: 100 });
  });

  test("a Regenerate's one block is listed even though it was saved", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t);
    await finishDone(t, jobId, runId);
    await t.withIdentity(human).mutation(api.research.regenerate, { jobId, key: "H1.1", overwriteEdit: false });
    expect(((await plan(t, jobId)).data.tracks as { key: string }[]).map((x) => x.key)).toEqual(["H1.1"]);
  });

  test("an embargoed track gets no first search and is named by key only (R8)", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("releases", { workspace: "real", artist: "Alfa Mist", title: "Organic Rust", embargo: { until: "2026-11-07" } }));
    const { jobId } = await startNotes(t);
    const { data } = await plan(t, jobId);
    expect(data.embargoed).toEqual(["H1.1"]);
    expect(JSON.stringify(data)).not.toMatch(/Alfa Mist|Organic Rust|2026-11-07/);
  });

  test("another workspace's job is 404; a stopped job, a verify job or a taken-over job gets no first searches", async () => {
    const t = convexTest(schema, modules);
    const { jobId, runId } = await startNotes(t);
    expect((await plan(t, jobId, DEMO_AGENT)).status).toBe(404);
    expect((await plan(t, "rj-nope00")).status).toBe(404);
    expect((await call(t, "/agent/research-prefetch", {})).status).toBe(400);
    await t.withIdentity(human).mutation(api.research.takeOver, { jobId });
    expect(await plan(t, jobId)).toEqual({ status: 409, data: { error: "Tarik took over; stop now." } });
    await finishRun(t, runId, "cancelled");
    const verify = await t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "pasted", text: "Out Oct 10." }, tracklistText: TRACKLIST });
    expect((await plan(t, verify.jobId)).data).toEqual({ error: "Only show notes and deep dives have first searches; use source_search." });
  });

  test("Oct 30 (decision 023): a deep dive lists its brief with five searches on the subject; a done brief is not listed", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.withIdentity(human).mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist" });
    const q = deepDiveQueries({ type: "artist", name: "Alfa Mist" });
    expect(await plan(t, jobId)).toEqual({ status: 200, data: { tracks: [{ key: "brief", query: q[0], query2: q[1], extra: q.slice(2) }], embargoed: [] } });
    await submit(t, { job: jobId, key: "brief", claims: [{ kind: "lead", text: "Alfa Mist is a London musician.", sources: [{ id: "S1aaaa" }] }], sources: SOURCES });
    expect(await plan(t, jobId)).toEqual({ status: 200, data: { tracks: [], embargoed: [] } });
  });

  test("a deep dive on an embargoed subject gets no first searches and is named by key only (R2, R8)", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("releases", { workspace: "real", artist: "Alfa Mist", title: "Organic Rust", embargo: { until: "2026-11-07" } }));
    const { jobId } = await t.withIdentity(human).mutation(api.research.startDeepDive, { type: "release", name: "Organic Rust" });
    expect(await plan(t, jobId)).toEqual({ status: 200, data: { tracks: [], embargoed: ["brief"] } });
    const artist = await t.withIdentity(human).mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist" });
    expect((await plan(t, artist.jobId)).data).toEqual({ tracks: [], embargoed: ["brief"] });
  });

  test("search-done gives back failed searches (never below zero) and adds Tavily credits to today's line in Settings", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 3; i++) await call(t, "/agent/search-usage", { query: `q${i}` });
    expect(await call(t, "/agent/search-done", { refund: 1, credits: 4 })).toEqual({ status: 200, data: {} });
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 2, cap: 100, credits: 4 });
    await call(t, "/agent/search-done", { refund: 9, credits: 2 });
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 0, cap: 100, credits: 6 });
    // The demo's own row; credits alone start one.
    await call(t, "/agent/search-done", { credits: 2 }, DEMO_AGENT);
    expect(await t.withIdentity(demo()).query(api.research.searchUsage, {})).toEqual({ used: 0, cap: 20, credits: 2 });
    for (const bad of [{ refund: -1 }, { credits: 1.5 }, { refund: 101 }, { credits: 10_001 }, { refund: "1" }, null]) {
      expect((await call(t, "/agent/search-done", bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("demo", () => {
  test("a demo start runs in the demo workspace; with the live cap reached it is refused with the paused sentence", async () => {
    const t = convexTest(schema, modules);
    const d = t.withIdentity(demo());
    const { jobId } = await startNotes(t, d);
    expect((await job(t, jobId))!.workspace).toBe("demo");
    expect(await t.withIdentity(human).query(api.research.get, { jobId })).toBeNull();
    vi.stubEnv("DEMO_LIVE", "0");
    expect(await errorOf(startNotes(t, t.withIdentity(demo("s2")), { showDate: "2026-11-06" }))).toEqual({
      code: "PAUSED", message: "Live research is paused for the demo today. The sample report is below.",
    });
    expect((await runs(t)).filter((r) => r.source === "scripted")).toEqual([]);
  });

  test("Paper notes and the episode tracklist cannot be chosen in the demo", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const d = t.withIdentity(demo());
    expect(await errorOf(d.mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errorOf(d.mutation(api.research.startShowNotes, { showDate: DATE, angles: true }))).toMatchObject({ code: "BAD_INPUT" });
  });
});

describe("past shows (deep dive, I3)", () => {
  test("counted from Tarik's real episodes in the year that play the artist; last is the newest; the export says so", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const played = (showDate: string, artist: string) => episode({
      showDate,
      tracklist: { status: "found", tracks: [{ hour: 1, position: 1, artist, title: "Some Song", raw: `${artist} – Some Song`, closing: false, status: "confirmed" }] },
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("episodes", played("2026-10-02", "ALFA MIST") as never);
      await ctx.db.insert("episodes", played("2026-03-06", "Alfa Mist & Jordan Rakei") as never); // a collaboration credit
      await ctx.db.insert("episodes", played("2026-02-06", "Kokoroko x Alfa Mist") as never);
      await ctx.db.insert("episodes", played("2026-09-04", "Kokoroko") as never);
      await ctx.db.insert("episodes", played("2025-12-05", "Alfa Mist") as never); // another year
      await ctx.db.insert("episodes", played("2026-05-01", "The Comet Is Coming") as never);
      await ctx.db.insert("episodes", played("2026-06-05", "Ama Ferrell") as never);
    });
    const { jobId } = await as.mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist", showDate: DATE });
    expect((await as.query(api.research.get, { jobId }))!.pastShows).toEqual({ count: 3, year: 2026, last: "2026-10-02" });
    expect(await as.query(api.research.exportMarkdown, { jobId })).toMatch(/On Rhythm Lab: 3 shows in 2026, last Oct 2, 2026/);
    // A leading "The" is ignored on both sides.
    const comet = await as.mutation(api.research.startDeepDive, { type: "artist", name: "Comet Is Coming", showDate: DATE });
    expect((await as.query(api.research.get, { jobId: comet.jobId }))!.pastShows).toEqual({ count: 1, year: 2026, last: "2026-05-01" });
    // No short-name match: "Ama" is not "Ama Ferrell". A zero is never asserted in the export (R10).
    const ama = await as.mutation(api.research.startDeepDive, { type: "artist", name: "Ama", showDate: DATE });
    expect((await as.query(api.research.get, { jobId: ama.jobId }))!.pastShows).toEqual({ count: 0, year: 2026 });
    expect(await as.query(api.research.exportMarkdown, { jobId: ama.jobId })).not.toMatch(/On Rhythm Lab|No past shows/);
  });

  test("the demo reads no episodes: no past-shows line at all", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("episodes", episode({ showDate: "2026-10-02" }) as never));
    const d = t.withIdentity(demo());
    const { jobId } = await d.mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist" });
    expect((await d.query(api.research.get, { jobId }))!.pastShows).toBeUndefined();
    expect(await d.query(api.research.exportMarkdown, { jobId })).not.toMatch(/On Rhythm Lab|No past shows/);
  });
});

describe("retarget duplicates (M3)", () => {
  test("two entries that would land on one key: the extra one is stale, never two live entries per key", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    const dup = ["HOUR 1", "Alfa Mist – Organic Rust", "Alfa Mist – Organic Rust", "Kokoroko – Abusey Junction", "HOUR 2", "Moses Boyd – Stranger Than Fiction"].join("\n");
    const { jobId } = await startNotes(t, as, { tracklistText: dup });
    await submit(t, { job: jobId, key: "H1.1", claims: [detail("First.")], sources: SOURCES });
    await submit(t, { job: jobId, key: "H1.2", claims: [detail("Second.")], sources: SOURCES });
    await as.mutation(api.research.takeOver, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await as.mutation(api.research.retarget, { jobId, tracklistText: ["HOUR 1", "Alfa Mist – Organic Rust", "Kokoroko – Abusey Junction", "HOUR 2", "Moses Boyd – Stranger Than Fiction"].join("\n") });
    const live = (await entries(t, jobId)).filter((e) => !e.stale);
    expect(live.map((e) => e.key)).toEqual(["H1.1"]);
    expect((await entries(t, jobId)).filter((e) => e.stale)).toHaveLength(1);
  });
});

describe("verify submits", () => {
  test("a line under a closing track is 409; a checked line saves claims and a replacement", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const { jobId } = await t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } });
    expect(await submit(t, { job: jobId, key: "L4", claims: [detail()], sources: SOURCES })).toEqual({
      status: 409, data: { error: "L4 is under a closing track. Closing tracks are never researched." },
    });
    const r = await submit(t, { job: jobId, key: "L2", claims: [detail()], replacement: "Recorded in London.", sources: SOURCES });
    expect(r).toMatchObject({ status: 200, data: { saved: "L2", claims: 1 } });
    expect((await entries(t, jobId))[0]).toMatchObject({ key: "L2", block: "line", replacement: "Recorded in London." });
    expect((await submit(t, { job: jobId, key: "L2", angle: "A connection?", sources: SOURCES })).data).toEqual({ problems: ["L2 does not take angle."] });
  });
});

describe("R11: the demo sample and other visitors' jobs cannot be changed", () => {
  const SAMPLE = { code: "SAMPLE", message: "The sample report can't be changed. Start your own from Plan." };

  test("edit, private, note, regenerate, resume, take over and retarget on rj-sample-* are refused; nothing changes; no run", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const d = t.withIdentity(demo());
    const before = await entries(t, "rj-sample-notes");
    const jobBefore = await job(t, "rj-sample-notes");
    const runsBefore = (await runs(t)).length;
    for (const call of [
      d.mutation(api.research.editEntry, { jobId: "rj-sample-notes", key: "H1.1", text: "defaced" }),
      d.mutation(api.research.setPrivate, { jobId: "rj-sample-notes", key: "H1.1", private: true }),
      d.mutation(api.research.setSuppliedNote, { jobId: "rj-sample-notes", key: "H1.1", note: "x" }),
      d.mutation(api.research.regenerate, { jobId: "rj-sample-notes", key: "H1.1", overwriteEdit: true }),
      d.mutation(api.research.resume, { jobId: "rj-sample-notes" }),
      d.mutation(api.research.takeOver, { jobId: "rj-sample-notes" }),
      d.mutation(api.research.retarget, { jobId: "rj-sample-notes", tracklistText: TRACKLIST }),
    ]) expect(await errorOf(call)).toEqual(SAMPLE);
    expect(await entries(t, "rj-sample-notes")).toEqual(before);
    expect(await job(t, "rj-sample-notes")).toEqual(jobBefore);
    expect((await runs(t)).length).toBe(runsBefore);
  });

  test("research.get says sample for the seeded jobs only", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {});
    const d = t.withIdentity(demo());
    expect((await d.query(api.research.get, { jobId: "rj-sample-notes" }))!.sample).toBe(true);
    const { jobId } = await startNotes(t, d);
    expect((await d.query(api.research.get, { jobId }))!.sample).toBe(false);
  });

  test("visitor B cannot touch visitor A's demo job (NOT_FOUND); A can", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(demo("sA"));
    const b = t.withIdentity(demo("sB"));
    const { jobId } = await startNotes(t, a);
    expect(await errorOf(b.mutation(api.research.editEntry, { jobId, key: "H1.1", text: "theirs" }))).toEqual({ code: "NOT_FOUND" });
    expect(await errorOf(b.mutation(api.research.takeOver, { jobId }))).toEqual({ code: "NOT_FOUND" });
    expect((await job(t, jobId))!.status).toBe("queued");
    await a.mutation(api.research.editEntry, { jobId, key: "H1.1", text: "mine" });
    expect((await entries(t, jobId)).find((e) => e.key === "H1.1")!.edited!.text).toBe("mine");
  });

  test("a demo Resume counts against the visitor's own session (sessionKey passed to the run)", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(demo("sA"));
    const { jobId } = await startNotes(t, a);
    await a.mutation(api.research.takeOver, { jobId });
    const { runId } = await a.mutation(api.research.resume, { jobId });
    const run = (await runs(t)).find((r) => r.runId === runId)!;
    expect(run.sessionKey).toBe("sA");
  });
});

// Plan 7 Task 5: Thursday and Friday at 9 am in Chicago, the pre-air check for the coming show queues itself.
describe("scheduledVerify (cron)", () => {
  const THU_9 = Date.UTC(2026, 9, 29, 14); // Thu Oct 29, 9 am CDT
  // convex-test never lets a transaction's time go back past the last commit, so each test only moves the clock forward.
  const at = (ms: number) => vi.setSystemTime(ms);
  const verifyJobs = async (t: T) => (await t.run((ctx) => ctx.db.query("research").collect())).filter((j) => j.kind === "verify");
  const cron = (t: T) => t.mutation(internal.research.scheduledVerify, {});

  test("Thursday 9 am queues a verify of the Paper notes for Friday's show; 8 am, a Wednesday and a second run that day do not", async () => {
    const t = convexTest(schema, modules);
    at(Date.UTC(2026, 9, 28, 14)); // Wednesday 9 am
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    await cron(t);
    at(THU_9 - 3_600_000);
    await cron(t);
    expect(await verifyJobs(t)).toEqual([]);
    at(THU_9 + 60_000);
    await cron(t);
    const [j] = await verifyJobs(t);
    expect(j).toMatchObject({ workspace: "real", showDate: DATE, notesSource: "paper", status: "queued" });
    expect(j!.lines!.some((l) => l.closing)).toBe(true);
    expect((await runs(t)).filter((r) => r.kind === "research")).toHaveLength(1);
    // The run ends; the same morning's next tick (or a later one that day) starts nothing more.
    await finishRun(t, j!.runIds[0]!, "failed");
    at(THU_9 + 30 * 60_000);
    await cron(t);
    expect(await verifyJobs(t)).toHaveLength(1);
  });

  test("Friday 9 am checks that day's show (CST after the clocks change too)", async () => {
    const t = convexTest(schema, modules);
    at(Date.UTC(2026, 10, 6, 14)); // Fri Nov 6, 8 am CST
    await t.run((ctx) => ctx.db.insert("episodes", episode({ showDate: "2026-11-06" }) as never));
    await cron(t);
    expect(await verifyJobs(t)).toEqual([]);
    at(Date.UTC(2026, 10, 6, 15)); // 9 am CST
    await cron(t);
    expect((await verifyJobs(t)).map((j) => j.showDate)).toEqual(["2026-11-06"]);
  });

  test("no notes anywhere (or notes but no tracklist): nothing queued, nothing thrown", async () => {
    const t = convexTest(schema, modules);
    at(THU_9);
    await cron(t);
    await t.run((ctx) => ctx.db.insert("episodes", episode({ notes: { status: "missing" } }) as never));
    await cron(t);
    expect(await verifyJobs(t)).toEqual([]);
    expect(await runs(t)).toEqual([]);
  });

  test("Air Check's newest done show notes come before the Paper notes", async () => {
    const t = convexTest(schema, modules);
    at(THU_9 - 2 * 3_600_000);
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const { jobId, runId } = await startNotes(t);
    await finishDone(t, jobId, runId, { "H1.1": "Air Check fact." });
    at(THU_9);
    await cron(t);
    const [j] = await verifyJobs(t);
    expect(j).toMatchObject({ notesSource: "air-check", showDate: DATE });
    expect(j!.lines!.map((l) => l.text).join("\n")).toMatch(/Air Check fact\./);
  });

  test("the demo workspace is never checked by the cron", async () => {
    const t = convexTest(schema, modules);
    at(THU_9 - 2 * 3_600_000);
    await startNotes(t, t.withIdentity(demo()));
    at(THU_9);
    await cron(t);
    expect(await verifyJobs(t)).toEqual([]);
  });
});

// Plan 7 Task 5 (P6): a finished real verify job gets 88Nine and HYFIN last-played dates, looked up in code.
describe("playContext", () => {
  type Call = { station: string; q: string };
  function fakePlays(played: Record<string, number>) {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { args } = JSON.parse(String(init.body)) as { args: { stationSlug: string; q: string } };
      calls.push({ station: args.stationSlug, q: args.q });
      const at = played[`${args.stationSlug}|${args.q}`];
      return new Response(JSON.stringify({ status: "success", value: at ? [{ artist: args.q, artistRaw: args.q, title: "T", playedAt: at }] : [] }));
    });
    return calls;
  }
  const finishVerify = async (t: T, jobId: string, runId: string, token = AGENT) => {
    for (const l of (await job(t, jobId))!.lines!.filter((x) => !x.closing)) await submit(t, { job: jobId, key: l.id, claims: [detail()], sources: SOURCES }, token);
    await finishRun(t, runId);
  };

  test("a done real verify job: one lookup per distinct artist and station, never a closing track's artist; found dates saved", async () => {
    const t = convexTest(schema, modules);
    const calls = fakePlays({ "88nine|Alfa Mist": Date.UTC(2026, 9, 20, 18), "hyfin|Yussef Dayes": Date.UTC(2026, 9, 2, 3) });
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const { jobId, runId } = await t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } });
    await finishVerify(t, jobId, runId);
    const j = (await job(t, jobId))!;
    expect(j.status).toBe("done");
    expect(calls).toEqual([
      { station: "88nine", q: "Alfa Mist" }, { station: "hyfin", q: "Alfa Mist" },
      { station: "88nine", q: "Yussef Dayes" }, { station: "hyfin", q: "Yussef Dayes" },
    ]);
    expect(j.playContext).toEqual([
      { artist: "Alfa Mist", station: "88nine", lastPlayed: "2026-10-20" },
      { artist: "Yussef Dayes", station: "hyfin", lastPlayed: "2026-10-01" },
    ]);
  });

  // The service being down: the first thrown lookup ends the pass, and what was found before it is saved.
  test("a thrown lookup stops the pass; the days found before it are saved", async () => {
    const t = convexTest(schema, modules);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { args } = JSON.parse(String(init.body)) as { args: { stationSlug: string; q: string } };
      calls.push(`${args.stationSlug}|${args.q}`);
      if (args.q === "Yussef Dayes") throw new Error("down");
      return new Response(JSON.stringify({ status: "success", value: [{ artist: args.q, title: "T", playedAt: Date.UTC(2026, 9, 20, 18) }] }));
    });
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const { jobId, runId } = await t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } });
    await finishVerify(t, jobId, runId);
    expect(calls).toEqual(["88nine|Alfa Mist", "hyfin|Alfa Mist", "88nine|Yussef Dayes"]);
    expect((await job(t, jobId))!.playContext!.map((p) => `${p.artist}|${p.station}`)).toEqual(["Alfa Mist|88nine", "Alfa Mist|hyfin"]);
  });

  test("past the deadline (8 minutes from the start) no new lookup starts; what was found is saved", async () => {
    const t = convexTest(schema, modules);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { args } = JSON.parse(String(init.body)) as { args: { stationSlug: string; q: string } };
      calls.push(`${args.stationSlug}|${args.q}`);
      vi.setSystemTime(Date.now() + 5 * 60_000); // each lookup "takes" 5 minutes
      return new Response(JSON.stringify({ status: "success", value: [{ artist: args.q, title: "T", playedAt: Date.UTC(2026, 9, 20, 18) }] }));
    });
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const { jobId, runId } = await t.withIdentity(human).mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } });
    await finishVerify(t, jobId, runId);
    expect(calls).toEqual(["88nine|Alfa Mist", "hyfin|Alfa Mist"]);
    expect((await job(t, jobId))!.playContext).toHaveLength(2);
  });

  test("a Regenerate that ends done again does not look anything up again or replace the saved context", async () => {
    const t = convexTest(schema, modules);
    const calls = fakePlays({ "88nine|Alfa Mist": Date.UTC(2026, 9, 20, 18) });
    await t.run((ctx) => ctx.db.insert("episodes", episode() as never));
    const as = t.withIdentity(human);
    const { jobId, runId } = await as.mutation(api.research.startVerify, { showDate: DATE, notes: { from: "paper" } });
    await finishVerify(t, jobId, runId);
    expect(calls).toHaveLength(4);
    const key = (await job(t, jobId))!.lines!.find((l) => !l.closing)!.id;
    const again = await as.mutation(api.research.regenerate, { jobId, key, overwriteEdit: false });
    await submit(t, { job: jobId, key, claims: [detail()], sources: SOURCES });
    await finishRun(t, again.runId);
    const j = (await job(t, jobId))!;
    expect(j.status).toBe("done");
    expect(calls).toHaveLength(4);
    expect(j.playContext).toEqual([{ artist: "Alfa Mist", station: "88nine", lastPlayed: "2026-10-20" }]);
  });

  test("the demo never looks anything up (Hard Rule 9), and show notes jobs do not either", async () => {
    const t = convexTest(schema, modules);
    const calls = fakePlays({});
    const d = t.withIdentity(demo());
    const v = await d.mutation(api.research.startVerify, { showDate: DATE, notes: { from: "pasted", text: "## 1. Alfa Mist – Organic Rust\nOut Oct 10." }, tracklistText: TRACKLIST });
    await finishVerify(t, v.jobId, v.runId, DEMO_AGENT);
    expect((await job(t, v.jobId))!.status).toBe("done");
    const n = await startNotes(t);
    await finishDone(t, n.jobId, n.runId);
    expect(calls).toEqual([]);
    expect((await job(t, v.jobId))!.playContext).toBeUndefined();
  });
});
