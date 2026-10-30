// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RUN_INSTRUCTIONS } from "@aircheck/core";
import { api } from "./_generated/api";
import schema from "./schema";
import { SCRIPTED_EVENTS } from "./scriptedEvents";

const modules = import.meta.glob("./**/*.*s");
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = (extra: Record<string, unknown> = {}) => ({ subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo", ...extra });
const RELAY = "r".repeat(40);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T18:00:00Z"));
  vi.stubEnv("RELAY_TOKEN", RELAY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const all = (t: ReturnType<typeof convexTest>, table: "runs" | "messages" | "conversations") => t.run((ctx) => ctx.db.query(table).collect());
const code = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ data: { code: expect.any(String) } });

describe("chat.send", () => {
  test("creates a conversation, a user message, an empty assistant message and one queued live run", async () => {
    const t = convexTest(schema, modules);
    const { conversationId, runId } = await t.withIdentity(human).mutation(api.chat.send, { text: "Who is Seun Kuti?" });
    const [conv] = await all(t, "conversations");
    expect(conv).toMatchObject({ workspace: "real", title: "Who is Seun Kuti?" });
    expect(String(conv!._id)).toBe(conversationId);
    const msgs = await all(t, "messages");
    expect(msgs.map((m) => [m.role, m.text, m.runId])).toEqual([["user", "Who is Seun Kuti?", undefined], ["assistant", "", runId]]);
    const [run] = await all(t, "runs");
    expect(run).toMatchObject({ runId, kind: "chat", source: "live", status: "queued", input: "Who is Seun Kuti?", conversationId, stopRequested: false, workspace: "real" });
    expect(run!.instructions).toBe(RUN_INSTRUCTIONS);
  });

  test("title is the first 60 characters; a follow-up reuses the conversation and sends only the new text", async () => {
    const t = convexTest(schema, modules);
    const me = t.withIdentity(human);
    const first = await me.mutation(api.chat.send, { text: "x".repeat(90) });
    const second = await me.mutation(api.chat.send, { conversationId: first.conversationId, text: "and then?" });
    expect(second.conversationId).toBe(first.conversationId);
    expect((await all(t, "conversations"))).toHaveLength(1);
    expect((await all(t, "conversations"))[0]!.title).toBe("x".repeat(60));
    const runs = await all(t, "runs");
    expect(runs.find((r) => r.runId === second.runId)).toMatchObject({ input: "and then?", conversationId: first.conversationId });
    expect(await me.query(api.chat.list, {})).toHaveLength(1);
    expect((await me.query(api.chat.messages, { conversationId: first.conversationId })).map((m) => m.text)).toEqual(["x".repeat(90), "", "and then?", ""]);
  });

  test("signed-out, empty text, and another workspace's conversation are refused", async () => {
    const t = convexTest(schema, modules);
    await code(t.mutation(api.chat.send, { text: "hi" }));
    await code(t.withIdentity(human).mutation(api.chat.send, { text: "   " }));
    const { conversationId } = await t.withIdentity(human).mutation(api.chat.send, { text: "mine" });
    await expect(t.withIdentity(demo()).mutation(api.chat.send, { conversationId, text: "steal" })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(await t.withIdentity(demo()).query(api.chat.messages, { conversationId })).toEqual([]);
    expect(await t.withIdentity(demo()).query(api.chat.list, {})).toEqual([]);
  });
});

describe("tracklist.draft", () => {
  test("queues a live draft-package run with the Hermes instruction and the form", async () => {
    const t = convexTest(schema, modules);
    const form = { showDate: "2026-10-02", tracklistText: "HOUR 1\nA – B", notes: "hi" };
    const { runId } = await t.withIdentity(human).mutation(api.tracklist.draft, form);
    const [run] = await all(t, "runs");
    expect(run).toMatchObject({ runId, kind: "draft-package", source: "live", status: "queued", form, workspace: "real" });
    expect(run!.instructions).toBe(RUN_INSTRUCTIONS);
    expect(run!.input).toContain("Draft the Mixcloud package for the show dated 2026-10-02.");
    expect(run!.input).toContain("A – B");
    const got = await t.withIdentity(human).query(api.runs.get, { runId });
    expect(got).toMatchObject({ kind: "draft-package", source: "live", status: "queued", stopRequested: false, form });
  });
});

describe("demo limits", () => {
  test("over DEMO_RUNS_PER_SESSION in 10 minutes is RATE_LIMITED; other sessions and later windows are fine", async () => {
    vi.stubEnv("DEMO_RUNS_PER_SESSION", "2");
    const t = convexTest(schema, modules);
    const s1 = t.withIdentity(demo({ sid: "s1" }));
    await s1.mutation(api.chat.send, { text: "1" });
    await s1.mutation(api.chat.send, { text: "2" });
    await expect(s1.mutation(api.chat.send, { text: "3" })).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } });
    await t.withIdentity(demo({ sid: "s2" })).mutation(api.chat.send, { text: "other session" });
    vi.setSystemTime(new Date("2026-10-27T18:10:01Z"));
    await s1.mutation(api.chat.send, { text: "later" });
    expect((await all(t, "runs")).filter((r) => r.sessionKey === "s1")).toHaveLength(3);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("session key falls back to subject when there is no sid; the real workspace has no limit", async () => {
    vi.stubEnv("DEMO_RUNS_PER_SESSION", "1");
    const t = convexTest(schema, modules);
    await t.withIdentity(demo()).mutation(api.chat.send, { text: "1" });
    await expect(t.withIdentity(demo()).mutation(api.chat.send, { text: "2" })).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } });
    expect((await all(t, "runs"))[0]!.sessionKey).toBe("d1");
    for (let i = 0; i < 4; i++) await t.withIdentity(human).mutation(api.chat.send, { text: `r${i}` });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("DEMO_LIVE=0 makes every demo run scripted, but the real workspace stays live", async () => {
    vi.stubEnv("DEMO_LIVE", "0");
    const t = convexTest(schema, modules);
    await t.withIdentity(demo()).mutation(api.chat.send, { text: "hi" });
    await t.withIdentity(human).mutation(api.chat.send, { text: "hi" });
    expect((await all(t, "runs")).map((r) => [r.workspace, r.source, r.status])).toEqual([["demo", "scripted", "running"], ["real", "live", "queued"]]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("past DEMO_LIVE_RUNS_PER_DAY demo runs go scripted; the count resets at Chicago midnight", async () => {
    vi.stubEnv("DEMO_LIVE_RUNS_PER_DAY", "2");
    vi.stubEnv("DEMO_RUNS_PER_SESSION", "100");
    const t = convexTest(schema, modules);
    vi.setSystemTime(new Date("2026-10-28T04:59:00Z")); // 23:59 CDT Oct 27
    for (const sid of ["a", "b", "c"]) await t.withIdentity(demo({ sid })).mutation(api.chat.send, { text: sid });
    expect((await all(t, "runs")).map((r) => r.source)).toEqual(["live", "live", "scripted"]);
    vi.setSystemTime(new Date("2026-10-28T05:00:01Z")); // 00:00 CDT Oct 28
    await t.withIdentity(demo({ sid: "d" })).mutation(api.chat.send, { text: "d" });
    expect((await all(t, "runs")).map((r) => r.source)).toEqual(["live", "live", "scripted", "live"]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("scripted runs never reach relay.pending", async () => {
    vi.stubEnv("DEMO_LIVE", "0");
    const t = convexTest(schema, modules);
    await t.withIdentity(demo()).mutation(api.chat.send, { text: "hi" });
    expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

describe("scripted replay", () => {
  test("no scripted event mentions a real pkg- id", () => {
    expect(JSON.stringify(SCRIPTED_EVENTS)).not.toMatch(/pkg-/);
  });

  test("plays the stored events, ends completed and fills the assistant message", async () => {
    vi.stubEnv("DEMO_LIVE", "0");
    const t = convexTest(schema, modules);
    const { conversationId, runId } = await t.withIdentity(demo()).mutation(api.chat.send, { text: "hi" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [run] = await all(t, "runs");
    expect(run).toMatchObject({ runId, status: "completed" });
    expect(run!.state.status).toBe("completed");
    expect(run!.state.steps).toHaveLength(3);
    const msgs = await t.withIdentity(demo()).query(api.chat.messages, { conversationId });
    expect(msgs[1]!.text).toContain("demo-10-2-26-u9qqq");
    expect(msgs[1]!.text).toBe(run!.state.reply);
  });

  test("stopping a scripted run cancels it and halts the remaining steps", async () => {
    vi.stubEnv("DEMO_LIVE", "0");
    const t = convexTest(schema, modules);
    const me = t.withIdentity(demo());
    const { runId } = await me.mutation(api.chat.send, { text: "hi" });
    vi.advanceTimersByTime(9_000);
    await t.finishInProgressScheduledFunctions();
    const before = (await all(t, "runs"))[0]!.state.steps.length;
    expect(before).toBeGreaterThan(0);
    await me.mutation(api.runs.requestStop, { runId });
    expect((await all(t, "runs"))[0]).toMatchObject({ status: "cancelled" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [run] = await all(t, "runs");
    expect(run).toMatchObject({ status: "cancelled" });
    expect(run!.state.steps).toHaveLength(before);
    expect(run!.state.status).toBe("cancelled");
  });
});

describe("runs.requestStop", () => {
  test("queued becomes cancelled; running becomes stopping with stopRequested; terminal is a no-op", async () => {
    const t = convexTest(schema, modules);
    const me = t.withIdentity(human);
    const a = await me.mutation(api.chat.send, { text: "a" });
    const b = await me.mutation(api.chat.send, { text: "b" });
    await t.mutation(api.relay.started, { token: RELAY, runId: b.runId, hermesRunId: "h-b" });
    await me.mutation(api.runs.requestStop, { runId: a.runId });
    await me.mutation(api.runs.requestStop, { runId: b.runId });
    const byId = async (id: string) => (await all(t, "runs")).find((r) => r.runId === id)!;
    expect(await byId(a.runId)).toMatchObject({ status: "cancelled", stopRequested: false });
    expect(await byId(b.runId)).toMatchObject({ status: "stopping", stopRequested: true });
    expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([
      { runId: b.runId, workspace: "real", kind: "chat", input: "b", instructions: RUN_INSTRUCTIONS, conversationId: b.conversationId, stopRequested: true, hermesRunId: "h-b", status: "stopping", lastSeq: undefined },
    ]);
    await t.mutation(api.relay.finished, { token: RELAY, runId: b.runId, status: "cancelled" });
    await me.mutation(api.runs.requestStop, { runId: b.runId });
    expect(await byId(b.runId)).toMatchObject({ status: "cancelled" });
  });

  test("another workspace's run, a missing run and a signed-out caller are NOT_FOUND", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.withIdentity(human).mutation(api.chat.send, { text: "a" });
    await expect(t.withIdentity(demo()).mutation(api.runs.requestStop, { runId })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(t.withIdentity(human).mutation(api.runs.requestStop, { runId: "nope" })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(t.mutation(api.runs.requestStop, { runId })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect((await all(t, "runs"))[0]).toMatchObject({ status: "queued" });
  });

  test("in the demo, only the visitor who started a run can stop it; another visitor gets NOT_FOUND", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.withIdentity(demo({ sid: "s1" })).mutation(api.chat.send, { text: "a" });
    await expect(t.withIdentity(demo({ sid: "s2" })).mutation(api.runs.requestStop, { runId })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect((await all(t, "runs"))[0]).toMatchObject({ status: "queued" });
    await t.withIdentity(demo({ sid: "s1" })).mutation(api.runs.requestStop, { runId });
    expect((await all(t, "runs"))[0]).toMatchObject({ status: "cancelled" });
  });
});
