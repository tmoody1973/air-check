// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const RELAY = "r".repeat(40);

beforeEach(() => vi.stubEnv("RELAY_TOKEN", RELAY));
afterEach(() => vi.unstubAllEnvs());

const tables = ["runs", "messages", "conversations", "activity", "packages", "sandboxStatus"] as const;
const snapshot = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => Promise.all(tables.map((n) => ctx.db.query(n).collect())));
const started = async () => {
  const t = convexTest(schema, modules);
  const sent = await t.withIdentity(human).mutation(api.chat.send, { text: "hi" });
  await t.mutation(api.relay.started, { token: RELAY, runId: sent.runId, hermesRunId: "h1" });
  return { t, ...sent };
};
const run = async (t: ReturnType<typeof convexTest>) => (await t.run((ctx) => ctx.db.query("runs").collect()))[0]!;
let nextSeq = 0; // seq is required; a global counter stays monotonic within every test
const ev = (event: string, data: Record<string, unknown> = {}, seq: number = ++nextSeq) => ({ event, data, t: 1, seq });

describe("fail closed", () => {
  const bad: [string, string | undefined][] = [["wrong", "w".repeat(40)], ["missing", ""], ["short", "r".repeat(31)]];
  test.each(bad)("%s token throws and writes nothing", async (_n, token) => {
    const t = convexTest(schema, modules);
    const { runId } = await t.withIdentity(human).mutation(api.chat.send, { text: "hi" });
    const before = await snapshot(t);
    const tk = token ?? "";
    await expect(t.query(api.relay.pending, { token: tk })).rejects.toThrow();
    await expect(t.mutation(api.relay.started, { token: tk, runId, hermesRunId: "x" })).rejects.toThrow();
    await expect(t.mutation(api.relay.events, { token: tk, runId, events: [ev("message.delta", { delta: "x" })] })).rejects.toThrow();
    await expect(t.mutation(api.relay.finished, { token: tk, runId, status: "failed" })).rejects.toThrow();
    await expect(t.mutation(api.relay.activity, { token: tk, workspace: "real", events: [{ key: "k", at: 1, decision: "blocked", host: "h", port: 1 }] })).rejects.toThrow();
    await expect(t.mutation(api.relay.status, { token: tk, workspace: "real", phase: "Ready", allowedHosts: 3 })).rejects.toThrow();
    expect(await snapshot(t)).toEqual(before);
  });

  test.each([["unset", undefined], ["31 chars", "r".repeat(31)]])("RELAY_TOKEN %s: all five relay functions throw and write nothing", async (_n, env) => {
    const t = convexTest(schema, modules);
    const { runId } = await t.withIdentity(human).mutation(api.chat.send, { text: "hi" });
    vi.stubEnv("RELAY_TOKEN", env ?? "");
    const before = await snapshot(t);
    const tk = env ?? "";
    await expect(t.query(api.relay.pending, { token: tk })).rejects.toThrow();
    await expect(t.mutation(api.relay.started, { token: tk, runId, hermesRunId: "x" })).rejects.toThrow();
    await expect(t.mutation(api.relay.events, { token: tk, runId, events: [ev("message.delta", { delta: "x" })] })).rejects.toThrow();
    await expect(t.mutation(api.relay.finished, { token: tk, runId, status: "failed" })).rejects.toThrow();
    await expect(t.mutation(api.relay.activity, { token: tk, workspace: "real", events: [{ key: "k", at: 1, decision: "blocked", host: "h", port: 1 }] })).rejects.toThrow();
    await expect(t.mutation(api.relay.status, { token: tk, workspace: "real", phase: "Ready", allowedHosts: 3 })).rejects.toThrow();
    expect(await snapshot(t)).toEqual(before);
  });
});

describe("relay.pending / started / finished", () => {
  test("lists queued live runs with the fields the relay needs", async () => {
    const t = convexTest(schema, modules);
    const a = await t.withIdentity(human).mutation(api.chat.send, { text: "hi" });
    expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([
      { runId: a.runId, workspace: "real", kind: "chat", input: "hi", conversationId: a.conversationId, stopRequested: false, hermesRunId: undefined, status: "queued", lastSeq: undefined },
    ]);
  });

  test("started moves queued to running and is idempotent for the same id; a cancelled run is not started", async () => {
    const t = convexTest(schema, modules);
    const me = t.withIdentity(human);
    const a = await me.mutation(api.chat.send, { text: "a" });
    const b = await me.mutation(api.chat.send, { text: "b" });
    expect(await t.mutation(api.relay.started, { token: RELAY, runId: a.runId, hermesRunId: "h" })).toEqual({ started: true });
    expect(await t.mutation(api.relay.started, { token: RELAY, runId: a.runId, hermesRunId: "h" })).toEqual({ started: true });
    expect((await t.query(api.relay.pending, { token: RELAY })).map((r) => r.status)).toEqual(["queued", "running"]);
    await me.mutation(api.runs.requestStop, { runId: b.runId });
    expect(await t.mutation(api.relay.started, { token: RELAY, runId: b.runId, hermesRunId: "h2" })).toEqual({ started: false });
    const rows = await t.run((ctx) => ctx.db.query("runs").collect());
    expect(rows.map((r) => [r.status, r.hermesRunId])).toEqual([["running", "h"], ["cancelled", undefined]]);
  });

  test("pending also returns running runs with hermesRunId and lastSeq, and stops once terminal", async () => {
    const { t, runId, conversationId } = await started();
    await t.mutation(api.relay.events, { token: RELAY, runId, events: [ev("message.delta", { delta: "x" }, 7)] });
    expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([
      { runId, workspace: "real", kind: "chat", input: "hi", conversationId, stopRequested: false, hermesRunId: "h1", status: "running", lastSeq: 7 },
    ]);
    await t.mutation(api.relay.finished, { token: RELAY, runId, status: "completed" });
    expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([]);
  });

  test("finished sets the terminal status once", async () => {
    const { t, runId } = await started();
    await t.mutation(api.relay.finished, { token: RELAY, runId, status: "failed" });
    await t.mutation(api.relay.finished, { token: RELAY, runId, status: "completed" });
    expect(await run(t)).toMatchObject({ status: "failed" });
    expect((await run(t)).state.status).toBe("failed");
  });
});

describe("relay.events", () => {
  test("applies events in order and writes the reply onto the assistant message", async () => {
    const { t, runId, conversationId } = await started();
    await t.mutation(api.relay.events, {
      token: RELAY, runId,
      events: [ev("tool.started", { tool: "web_search", preview: "q" }), ev("tool.completed", { tool: "web_search", duration: 1 }), ev("message.delta", { delta: "Hel" }), ev("message.delta", { delta: "lo" })],
    });
    const r = await run(t);
    expect(r.state.steps).toHaveLength(1);
    expect(r.state.steps[0]).toMatchObject({ tool: "web_search", status: "done" });
    const msgs = await t.withIdentity(human).query(api.chat.messages, { conversationId });
    expect(msgs[1]!.text).toBe("Hello");
  });

  test("the same batch twice (with seq) leaves the same step count and reply", async () => {
    const { t, runId, conversationId } = await started();
    const events = [ev("tool.started", { tool: "a" }, 1), ev("tool.completed", { tool: "a" }, 2), ev("message.delta", { delta: "x" }, 3)];
    await t.mutation(api.relay.events, { token: RELAY, runId, events });
    await t.mutation(api.relay.events, { token: RELAY, runId, events });
    expect((await run(t)).state.steps).toHaveLength(1);
    expect((await t.withIdentity(human).query(api.chat.messages, { conversationId }))[1]!.text).toBe("x");
    await t.mutation(api.relay.events, { token: RELAY, runId, events: [...events, ev("message.delta", { delta: "y" }, 4)] });
    expect((await t.withIdentity(human).query(api.chat.messages, { conversationId }))[1]!.text).toBe("xy");
  });

  test("events for a finished run are ignored", async () => {
    const { t, runId } = await started();
    await t.mutation(api.relay.finished, { token: RELAY, runId, status: "completed" });
    await t.mutation(api.relay.events, { token: RELAY, runId, events: [ev("tool.started", { tool: "a" })] });
    expect((await run(t)).state.steps).toHaveLength(0);
  });

  test("sets packageId only when the package exists in the run's workspace, and never writes packages", async () => {
    const { t, runId } = await started();
    const pkgs = () => t.run((ctx) => ctx.db.query("packages").collect());
    await t.mutation(api.relay.events, { token: RELAY, runId, events: [ev("run.completed", { output: "Submitted pkg-10-9-26 for review" })] });
    expect((await run(t)).packageId).toBeUndefined();

    await t.run((ctx) => ctx.db.insert("packages", { packageId: "pkg-10-9-26", workspace: "real", status: "awaiting_review", draft: {} }));
    const before = await pkgs();
    await t.mutation(api.relay.events, { token: RELAY, runId, events: [ev("message.delta", { delta: "see pkg-10-9-26" })] });
    expect((await run(t)).packageId).toBe("pkg-10-9-26");
    expect(await pkgs()).toEqual(before);
  });

  test("a demo run only links demo- packages: a real pkg- id in its output gets nothing", async () => {
    const t = convexTest(schema, modules);
    const sent = await t.withIdentity({ ...human, role: "demo" }).mutation(api.chat.send, { text: "hi" });
    await t.mutation(api.relay.started, { token: RELAY, runId: sent.runId, hermesRunId: "h" });
    await t.run(async (ctx) => {
      await ctx.db.insert("packages", { packageId: "pkg-10-9-26", workspace: "real", status: "awaiting_review", draft: {} });
      await ctx.db.insert("packages", { packageId: "demo-10-9-26", workspace: "demo", status: "awaiting_review", draft: {} });
    });
    const before = await t.run((ctx) => ctx.db.query("packages").collect());
    await t.mutation(api.relay.events, { token: RELAY, runId: sent.runId, events: [ev("message.delta", { delta: "Submitted pkg-10-9-26." })] });
    expect((await run(t)).packageId).toBeUndefined();
    await t.mutation(api.relay.events, { token: RELAY, runId: sent.runId, events: [ev("message.delta", { delta: " Also demo-10-9-26." })] });
    expect((await run(t)).packageId).toBe("demo-10-9-26");
    expect(await t.run((ctx) => ctx.db.query("packages").collect())).toEqual(before);
  });

  test("reads the id from a package_submit tool.completed", async () => {
    const { t, runId } = await started();
    await t.run((ctx) => ctx.db.insert("packages", { packageId: "pkg-1-2-26", workspace: "real", status: "preparing_audio", draft: {} }));
    await t.mutation(api.relay.events, {
      token: RELAY, runId,
      events: [ev("tool.started", { tool: "mcp__aircheck__package_submit" }), ev("tool.completed", { tool: "mcp__aircheck__package_submit", result: "{\"packageId\":\"pkg-1-2-26\"}" })],
    });
    expect((await run(t)).packageId).toBe("pkg-1-2-26");
  });
});

describe("relay.activity", () => {
  test("inserts network rows and skips keys already stored", async () => {
    const t = convexTest(schema, modules);
    const events = [
      { key: "blocked|evil.example:443|1", at: 1000, decision: "blocked" as const, host: "evil.example", port: 443, reason: "not allowed" },
      { key: "allowed|api.tavily.com:443|2", at: 2000, decision: "allowed" as const, host: "api.tavily.com", port: 443, binary: "/usr/bin/python3" },
    ];
    await t.mutation(api.relay.activity, { token: RELAY, workspace: "real", events });
    await t.mutation(api.relay.activity, { token: RELAY, workspace: "real", events: [...events, { key: "allowed|new:80|3", at: 3000, decision: "allowed", host: "new", port: 80 }] });
    const rows = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.key === events[0]!.key)).toMatchObject({ workspace: "real", kind: "network", result: "blocked", title: "Blocked connection", destination: "evil.example:443", reason: "not allowed", at: 1000 });
    expect(rows.find((r) => r.key === events[1]!.key)).toMatchObject({ result: "allowed", title: "Connection", destination: "api.tavily.com:443" });
  });

  test("the same key in two workspaces is two rows; repeats inside one batch insert once", async () => {
    const t = convexTest(schema, modules);
    const e = { key: "k", at: 1, decision: "allowed" as const, host: "h", port: 1 };
    await t.mutation(api.relay.activity, { token: RELAY, workspace: "real", events: [e, e] });
    await t.mutation(api.relay.activity, { token: RELAY, workspace: "demo", events: [e] });
    expect(await t.run((ctx) => ctx.db.query("activity").collect())).toHaveLength(2);
  });
});

describe("relay.status and sandbox.get", () => {
  test("upserts one row per workspace; sandbox.get returns only the caller's workspace row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.relay.status, { token: RELAY, workspace: "real", phase: "Ready", allowedHosts: 10 });
    await t.mutation(api.relay.status, { token: RELAY, workspace: "real", phase: "Ready", allowedHosts: 11 });
    await t.mutation(api.relay.status, { token: RELAY, workspace: "demo", phase: null, allowedHosts: 0 });
    expect(await t.run((ctx) => ctx.db.query("sandboxStatus").collect())).toHaveLength(2);
    const mine = await t.withIdentity(human).query(api.sandbox.get, {});
    expect(mine).toMatchObject({ workspace: "real", phase: "Ready", allowedHosts: 11 });
    expect(typeof mine!.at).toBe("number");
    expect(await t.query(api.sandbox.get, {})).toBeNull();
  });
  test("a demo caller sees only the demo row and a real caller only the real row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.relay.status, { token: RELAY, workspace: "real", phase: "Ready", allowedHosts: 10 });
    await t.mutation(api.relay.status, { token: RELAY, workspace: "demo", phase: "Ready", allowedHosts: 2 });
    expect(await t.withIdentity(human).query(api.sandbox.get, {})).toMatchObject({ workspace: "real", allowedHosts: 10 });
    expect(await t.withIdentity({ ...human, role: "demo" }).query(api.sandbox.get, {})).toMatchObject({ workspace: "demo", allowedHosts: 2 });
  });
  test("returns null when no status has been sent", async () => {
    expect(await convexTest(schema, modules).withIdentity(human).query(api.sandbox.get, {})).toBeNull();
  });
  test("a blocked network row from the relay is listed for Trust with its host and port", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.relay.activity, { token: RELAY, workspace: "real", events: [{ key: "blocked|evil.example:443|1", at: 1000, decision: "blocked", host: "evil.example", port: 443, reason: "no policy" }] });
    const rows = await t.withIdentity(human).query(api.activity.list, { kind: "blocked" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "network", result: "blocked", destination: "evil.example:443" });
  });
});
