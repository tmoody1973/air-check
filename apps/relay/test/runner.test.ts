import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { HermesClient } from "../src/hermes.js";
import { createRunner, type Runner } from "../src/runner.js";
import { FakeConvex, FakeHermes, fixture, row, sse, waitFor } from "./helpers.js";

const TOKEN = "tok-real-SECRET-0123456789abcdef0123456789";
const DEMO_TOKEN = "tok-demo-SECRET-0123456789abcdef0123456789";
let real: FakeHermes, demo: FakeHermes, convex: FakeConvex, logs: string[], runner: Runner;

beforeEach(async () => {
  real = await new FakeHermes().listen();
  demo = await new FakeHermes().listen();
  convex = new FakeConvex();
  logs = [];
  runner = createRunner({
    convex,
    sandboxes: [
      { name: "airc", workspace: "real", hermes: new HermesClient(`http://127.0.0.1:${real.port}`, TOKEN) },
      { name: "aircdemo", workspace: "demo", hermes: new HermesClient(`http://127.0.0.1:${demo.port}`, DEMO_TOKEN) },
    ],
    log: (l) => logs.push(l),
    flushMs: 10,
    backoffMs: () => 1,
  });
});
afterEach(async () => { runner.stop(); await real.close(); await demo.close(); });

describe("starting a queued run", () => {
  test("posts to Hermes with auth + idempotency key, streams events in order, then finishes", async () => {
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1, "finish");
    expect(real.starts).toHaveLength(1);
    expect(real.starts[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(real.starts[0]!.headers["idempotency-key"]).toBe("r1");
    expect(real.starts[0]!.body).toEqual({ input: "SECRET-INPUT", instructions: "SCOPE-INSTRUCTIONS", session_id: "conv1" });
    expect(convex.startedCalls).toEqual([{ runId: "r1", hermesRunId: expect.stringMatching(/^h-/) }]);
    expect(convex.names("r1")).toEqual(fixture.map((e) => e.event));
    expect(convex.seqs("r1")).toEqual(fixture.map((_, i) => i + 1));
    expect(convex.finishedCalls).toEqual([{ runId: "r1", status: "completed" }]);
  });

  test("a row without instructions (queued before the field existed) sends none", async () => {
    runner.onPending([row({ runId: "r1", instructions: undefined })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(real.starts[0]!.body).toEqual({ input: "SECRET-INPUT", session_id: "conv1" });
  });

  test("draft-package runs send no session_id", async () => {
    runner.onPending([row({ runId: "r1", kind: "draft-package", conversationId: undefined })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(real.starts[0]!.body).toEqual({ input: "SECRET-INPUT", instructions: "SCOPE-INSTRUCTIONS" });
  });

  test("started:false (cancelled while queued) sends stop and streams nothing", async () => {
    convex.startedResult = false;
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => real.stops.length === 1, "stop");
    await new Promise((r) => setTimeout(r, 50));
    expect(real.opens).toEqual({});
    expect(convex.eventCalls).toEqual([]);
    expect(convex.finishedCalls).toEqual([]);
  });

  test("a run for an unconfigured (empty-token) sandbox is skipped", async () => {
    const only = createRunner({
      convex, log: (l) => logs.push(l), flushMs: 10, backoffMs: () => 1,
      sandboxes: [{ name: "airc", workspace: "real", hermes: new HermesClient(`http://127.0.0.1:${real.port}`, TOKEN) }],
    });
    only.onPending([row({ runId: "d1", workspace: "demo" })]);
    await new Promise((r) => setTimeout(r, 50));
    expect(demo.starts).toEqual([]);
    expect(convex.startedCalls).toEqual([]);
    only.stop();
  });

  test("run.interrupted finishes as failed", async () => {
    real.events = (_id, _o, res) => { sse(res, "message.delta", { delta: "x" }); sse(res, "run.interrupted", {}); res.end(); };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(convex.finishedCalls[0]).toEqual({ runId: "r1", status: "failed" });
  });

  test("deltas are batched, not sent one by one", async () => {
    real.events = (_id, _o, res) => {
      for (let i = 0; i < 20; i++) sse(res, "message.delta", { delta: `w${i}` });
      sse(res, "run.completed", { output: "done" });
      res.end();
    };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(convex.seqs("r1")).toHaveLength(21);
    expect(convex.eventCalls.length).toBeLessThan(21);
  });
});

describe("concurrency", () => {
  test("a third queued run waits for a free slot; the other sandbox is not blocked", async () => {
    const release: (() => void)[] = [];
    real.events = (_id, _o, res) => { release.push(() => { sse(res, "run.completed", { output: "ok" }); res.end(); }); };
    demo.events = (_id, _o, res) => { sse(res, "run.completed", { output: "ok" }); res.end(); };
    const rows = [row({ runId: "a" }), row({ runId: "b" }), row({ runId: "c" }), row({ runId: "d", workspace: "demo" })];
    convex.onFinished = (id) => runner.onPending(rows.filter((r) => !convex.finishedCalls.some((f) => f.runId === r.runId) && r.runId !== id));
    runner.onPending(rows);
    await waitFor(() => release.length === 2 && convex.finishedCalls.some((f) => f.runId === "d"), "two live + demo done");
    await new Promise((r) => setTimeout(r, 50));
    expect(real.starts).toHaveLength(2);
    release[0]!();
    await waitFor(() => real.starts.length === 3, "third starts after a slot frees");
    release[1]!();
    await waitFor(() => release.length === 3);
    release[2]!();
    await waitFor(() => convex.finishedCalls.length === 4);
  });
});

describe("stopping", () => {
  test("a stop request reaches /stop once, however many updates repeat it", async () => {
    real.events = (_id, _o, res) => { sse(res, "message.delta", { delta: "hi" }); res.once("close", () => {}); };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.startedCalls.length === 1);
    const hid = convex.startedCalls[0]!.hermesRunId;
    const stopping = row({ runId: "r1", status: "stopping", stopRequested: true, hermesRunId: hid });
    runner.onPending([stopping]);
    runner.onPending([stopping]);
    await waitFor(() => real.stops.length === 1, "stop");
    await new Promise((r) => setTimeout(r, 30));
    expect(real.stops).toEqual([hid]);
    // Hermes then reports the cancel on the stream.
    [...real.open][0]!.write(`event: run.cancelled\ndata: {}\n\n`);
    [...real.open][0]!.end();
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(convex.finishedCalls[0]).toEqual({ runId: "r1", status: "cancelled" });
  });
});

describe("dropped streams and restarts", () => {
  test("a stream that drops mid-run is reconciled with GET and reopened, renumbering from 1", async () => {
    real.events = (id, open, res) => {
      sse(res, "tool.started", { tool: "t" });
      sse(res, "tool.completed", { tool: "t" });
      if (open === 1) return void res.end(); // dropped
      sse(res, "run.completed", { output: "done" });
      res.end();
    };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    const id = convex.startedCalls[0]!.hermesRunId;
    expect(real.gets).toContain(id);
    expect(real.opens[id]).toBe(2);
    expect(convex.seqs("r1")).toEqual([1, 2, 1, 2, 3]);
  });

  test("a dropped stream whose run already finished gets one synthetic terminal event at lastSeq+1", async () => {
    real.events = (id, open, res) => {
      sse(res, "message.delta", { delta: "a" }); sse(res, "message.delta", { delta: "b" });
      if (open >= 2) real.info[id] = { status: "completed", output: "final" }; // finished while the relay was reconnecting
      res.end();
    };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    const last = convex.eventCalls.at(-1)!.events.at(-1)!;
    expect(last).toMatchObject({ event: "run.completed", data: { output: "final" }, seq: 3 });
    expect(convex.finishedCalls[0]).toEqual({ runId: "r1", status: "completed" });
  });

  test("restart: a running run that is already terminal in Hermes is finished with one synthetic event", async () => {
    real.info["h-old"] = { status: "failed" };
    runner.onPending([row({ runId: "r1", status: "running", hermesRunId: "h-old", lastSeq: 5 })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(convex.eventCalls).toEqual([{ runId: "r1", events: [expect.objectContaining({ event: "run.failed", seq: 6 })] }]);
    expect(convex.finishedCalls[0]).toEqual({ runId: "r1", status: "failed" });
    expect(real.opens).toEqual({});
    expect(real.starts).toEqual([]);
  });

  test("restart: a still-live running run reopens the stream (and is never started again)", async () => {
    real.info["h-live"] = { status: "running" };
    runner.onPending([row({ runId: "r1", status: "running", hermesRunId: "h-live", lastSeq: 4 })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(real.opens["h-live"]).toBe(1);
    expect(convex.seqs("r1")[0]).toBe(1);
    expect(real.starts).toEqual([]);
  });

  test("repeated pending updates do not double-stream a run", async () => {
    real.events = (_id, _o, res) => { sse(res, "message.delta", { delta: "a" }); };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.startedCalls.length === 1);
    const running = row({ runId: "r1", status: "running", hermesRunId: convex.startedCalls[0]!.hermesRunId });
    runner.onPending([running]); runner.onPending([running]);
    await new Promise((r) => setTimeout(r, 50));
    expect(real.opens[running.hermesRunId!]).toBe(1);
    expect(real.starts).toHaveLength(1);
  });

  test("a failing Hermes start does not crash and is retried", async () => {
    let n = 0;
    const original = real.server.listeners("request")[0] as (...a: unknown[]) => void;
    real.server.removeAllListeners("request");
    real.server.on("request", (req, res) => (req.method === "POST" && req.url === "/v1/runs" && ++n === 1 ? res.writeHead(500).end() : original(req, res)));
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1, "finish after retry");
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe("fix round 1", () => {
  test("a failed relay.events call is retried: every event lands in order with no gaps", async () => {
    real.events = (_id, _o, res) => {
      for (let i = 0; i < 6; i++) sse(res, "message.delta", { delta: `w${i}` });
      sse(res, "run.completed", { output: "ok" });
      res.end();
    };
    const orig = convex.events.bind(convex);
    let calls = 0;
    convex.events = async (id, ev) => { if (++calls === 1) throw new Error("convex down"); return orig(id, ev); };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(convex.seqs("r1")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(logs.join("\n")).toMatch(/run=r1 event=events_retry n=1/);
  });

  test("data-only SSE frames complete the run through the stream, not the GET fallback", async () => {
    real.events = (_id, _o, res) => {
      res.write(`data: ${JSON.stringify({ event: "message.delta", delta: "hi" })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: "run.completed", output: "hi" })}\n\n`);
      res.end();
    };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(convex.names("r1")).toEqual(["message.delta", "run.completed"]);
    expect(real.gets).toEqual([]);
  });

  test("GET 404 (Hermes lost the run) -> one synthetic run.failed at lastSeq+1, finished failed, no retries", async () => {
    const original = real.server.listeners("request")[0] as (...a: unknown[]) => void;
    real.server.removeAllListeners("request");
    real.server.on("request", (req, res) => (req.method === "GET" && /^\/v1\/runs\/h-old$/.test(req.url ?? "") ? res.writeHead(404).end() : original(req, res)));
    runner.onPending([row({ runId: "r1", status: "running", hermesRunId: "h-old", lastSeq: 9 })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(convex.eventCalls).toEqual([{ runId: "r1", events: [expect.objectContaining({ event: "run.failed", seq: 10 })] }]);
    expect(convex.finishedCalls).toEqual([{ runId: "r1", status: "failed" }]);
  });

  test("Hermes status interrupted maps to run.interrupted / failed", async () => {
    real.info["h-i"] = { status: "interrupted" };
    runner.onPending([row({ runId: "r1", status: "running", hermesRunId: "h-i", lastSeq: 1 })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    expect(convex.eventCalls[0]!.events[0]).toMatchObject({ event: "run.interrupted", seq: 2 });
    expect(convex.finishedCalls[0]!.status).toBe("failed");
  });

  test("a 5xx stop is retried; a 4xx stop is not", async () => {
    const original = real.server.listeners("request")[0] as (...a: unknown[]) => void;
    let stops = 0;
    real.server.removeAllListeners("request");
    real.server.on("request", (req, res) => (req.url?.endsWith("/stop") ? (++stops, res.writeHead(stops === 1 ? 503 : 404).end()) : original(req, res)));
    const stopping = row({ runId: "r1", status: "stopping", stopRequested: true, hermesRunId: "h-s" });
    real.info["h-s"] = { status: "running" };
    real.events = () => {};
    runner.onPending([stopping]);
    await waitFor(() => stops === 2, "stop retried after 503");
    await new Promise((r) => setTimeout(r, 40));
    expect(stops).toBe(2); // the 404 ended it
  });
});

describe("logging (Hard Rule 8)", () => {
  test("logs run/event/n lines and never a token, the input, or message text", async () => {
    real.events = (_id, _o, res) => { sse(res, "message.delta", { delta: "PRIVATE-REPLY-TEXT" }); sse(res, "run.completed", { output: "PRIVATE-REPLY-TEXT" }); res.end(); };
    runner.onPending([row({ runId: "r1" }), row({ runId: "d1", workspace: "demo" })]);
    demo.events = real.events;
    await waitFor(() => convex.finishedCalls.length === 2);
    const all = logs.join("\n");
    expect(all).toMatch(/run=r1 event=\S+ n=\d+/);
    for (const secret of [TOKEN, DEMO_TOKEN, "SECRET-INPUT", "SCOPE-INSTRUCTIONS", "PRIVATE-REPLY-TEXT"]) expect(all).not.toContain(secret);
  });
});

describe("permanent errors and lost runs (R26)", () => {
  const notFound = () => new ConvexError({ code: "NOT_FOUND" });

  test("relay.events rejects NOT_FOUND -> Hermes stop sent, event=dropped logged, slot freed for the next run", async () => {
    const one = createRunner({
      convex, log: (l) => logs.push(l), flushMs: 10, backoffMs: () => 1, maxLive: 1,
      sandboxes: [{ name: "airc", workspace: "real", hermes: new HermesClient(`http://127.0.0.1:${real.port}`, TOKEN) }],
    });
    const orig = convex.events.bind(convex);
    let r1Calls = 0;
    convex.events = async (id, ev) => { if (id === "r1") { r1Calls++; throw notFound(); } return orig(id, ev); };
    one.onPending([row({ runId: "r1" }), row({ runId: "r2" })]);
    await waitFor(() => convex.finishedCalls.some((f) => f.runId === "r2"), "r2 runs once r1 is dropped");
    expect(r1Calls).toBe(1); // permanent: never retried
    expect(real.stops).toEqual([convex.startedCalls.find((c) => c.runId === "r1")!.hermesRunId]);
    expect(logs).toContain("run=r1 event=dropped n=1");
    expect(convex.finishedCalls.map((f) => f.runId)).toEqual(["r2"]);
    one.stop();
  });

  test("an argument-validation error is permanent too", async () => {
    convex.events = async () => { throw new Error("[CONVEX M(relay:events)] Server Error\nArgumentValidationError: Object is missing the required field `seq`."); };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => logs.includes("run=r1 event=dropped n=1"), "dropped");
    expect(real.stops).toHaveLength(1);
  });

  test("10 transient relay.events failures -> dropped", async () => {
    let calls = 0;
    convex.events = async () => { calls++; throw new Error("socket hang up"); };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => logs.includes("run=r1 event=dropped n=1"), "dropped");
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(10);
    expect(logs.filter((l) => l.startsWith("run=r1 event=events_retry"))).toHaveLength(9);
    expect(real.stops).toHaveLength(1);
    expect(convex.finishedCalls).toEqual([]);
  });

  test("a 404 from the events endpoint means the run is lost: one synthetic run.failed, finished failed", async () => {
    const original = real.server.listeners("request")[0] as (...a: unknown[]) => void;
    real.server.removeAllListeners("request");
    real.server.on("request", (req, res) => (req.url === "/v1/runs/h-gone/events" ? res.writeHead(404).end() : original(req, res)));
    real.info["h-gone"] = { status: "running" };
    runner.onPending([row({ runId: "r1", status: "running", hermesRunId: "h-gone", lastSeq: 3 })]);
    await waitFor(() => convex.finishedCalls.length === 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(convex.eventCalls).toEqual([{ runId: "r1", events: [expect.objectContaining({ event: "run.failed", seq: 4 })] }]);
    expect(convex.finishedCalls).toEqual([{ runId: "r1", status: "failed" }]);
  });

  test("relay.started throws after Hermes started the run -> the Hermes run is stopped", async () => {
    convex.started = async (runId, hermesRunId) => { convex.startedCalls.push({ runId, hermesRunId }); throw new ConvexError({ code: "UNAUTHORIZED" }); };
    runner.onPending([row({ runId: "r1" })]);
    await waitFor(() => real.stops.length === 1, "stop");
    expect(real.stops).toEqual([convex.startedCalls[0]!.hermesRunId]);
    expect(logs).toContain("run=r1 event=dropped n=1");
    expect(real.opens).toEqual({});
  });
});
