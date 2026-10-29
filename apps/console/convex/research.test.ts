// @vitest-environment edge-runtime
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
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
});
afterEach(() => {
  vi.unstubAllEnvs();
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

  test("a sourceless claim is dropped and named; the rest is saved", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await startNotes(t);
    const r = await submit(t, { job: jobId, key: "H1.2", claims: [detail(), { kind: "bio", text: "Born in Leeds.", sources: [] }], sources: SOURCES });
    expect(r).toEqual({ status: 200, data: { saved: "H1.2", claims: 1, verify: 0, dropped: ["Claim 2 has no source. No source, no sentence."] } });
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

  test("30 real and 10 demo per Chicago day, separate per workspace, then allowed: false without counting; the next day starts again", async () => {
    const t = convexTest(schema, modules);
    for (let i = 1; i <= 30; i++) expect((await usage(t, { query: `q${i}` })).data).toEqual({ allowed: true, used: i, cap: 30 });
    expect((await usage(t, { query: "one more" })).data).toEqual({ allowed: false, used: 30, cap: 30 });
    for (let i = 1; i <= 10; i++) await usage(t, { query: `d${i}` }, DEMO_AGENT);
    expect((await usage(t, { query: "one more" }, DEMO_AGENT)).data).toEqual({ allowed: false, used: 10, cap: 10 });
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 30, cap: 30 });
    expect(await t.withIdentity(demo()).query(api.research.searchUsage, {})).toEqual({ used: 10, cap: 10 });
    vi.setSystemTime(Date.UTC(2026, 9, 31, 5, 30)); // 00:30 Oct 31 in Chicago
    expect((await usage(t, { query: "new day" })).data).toEqual({ allowed: true, used: 1, cap: 30 });
  });

  test("a query naming an active embargo is refused without counting and names nothing", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("releases", { workspace: "real", artist: "Alfa Mist", title: "Organic Rust", embargo: { until: "2026-11-07" } }));
    expect(await usage(t, { query: "Alfa Mist Organic Rust release date" })).toEqual({ status: 200, data: { allowed: false, embargoed: true } });
    expect((await usage(t, { query: "Alfa Mist Organic Rust" }, DEMO_AGENT)).data).toMatchObject({ allowed: true }); // other workspace
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 0, cap: 30 });
  });

  test("Apple Music lookups count apart from web search (60 real per day)", async () => {
    const t = convexTest(schema, modules);
    expect((await usage(t, { query: "Organic Rust", source: "apple_music" })).data).toEqual({ allowed: true, used: 1, cap: 60 });
    expect(await t.withIdentity(human).query(api.research.searchUsage, {})).toEqual({ used: 0, cap: 30 });
    expect((await usage(t, { query: "x", source: "spotify" })).status).toBe(400);
    expect((await usage(t, {})).status).toBe(400);
  });

  test("countSearch is concurrency-safe: parallel calls never pass the cap", async () => {
    const t = convexTest(schema, modules);
    const all = await Promise.all(Array.from({ length: 12 }, (_, i) => t.mutation(internal.research.countSearch, { workspace: "demo", query: `q${i}` })));
    expect(all.filter((r) => r.allowed)).toHaveLength(10);
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
      await ctx.db.insert("episodes", played("2026-03-06", "Alfa Mist") as never);
      await ctx.db.insert("episodes", played("2026-09-04", "Kokoroko") as never);
      await ctx.db.insert("episodes", played("2025-12-05", "Alfa Mist") as never); // another year
    });
    const { jobId } = await as.mutation(api.research.startDeepDive, { type: "artist", name: "Alfa Mist", showDate: DATE });
    expect((await as.query(api.research.get, { jobId }))!.pastShows).toEqual({ count: 2, year: 2026, last: "2026-10-02" });
    expect(await as.query(api.research.exportMarkdown, { jobId })).toMatch(/On Rhythm Lab: 2 shows in 2026, last Oct 2, 2026/);
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
