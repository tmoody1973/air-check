import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { PendingRun, RelayConvex } from "../src/convex.js";

export interface FixtureEvent { t: number; event: string; data: Record<string, unknown> }
export const fixture: FixtureEvent[] = readFileSync(new URL("../../../packages/core/test/fixtures/hermes-run-events.ndjson", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l) as FixtureEvent);

export const sse = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** A Hermes Runs API stand-in. `events` decides what each stream does; default plays the real fixture then ends. */
export class FakeHermes {
  server!: Server;
  port = 0;
  starts: { headers: IncomingMessage["headers"]; body: Record<string, unknown> }[] = [];
  stops: string[] = [];
  gets: string[] = [];
  opens: Record<string, number> = {};
  info: Record<string, { status: string; output?: string }> = {};
  open = new Set<ServerResponse>();
  private n = 0;
  events: (id: string, open: number, res: ServerResponse) => void = (_id, _o, res) => {
    for (const e of fixture) sse(res, e.event, e.data);
    res.end();
  };

  async listen(): Promise<this> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => this.route(req, res, body));
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  private route(req: IncomingMessage, res: ServerResponse, body: string) {
    const url = req.url ?? "";
    const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (req.method === "POST" && url === "/v1/runs") {
      this.starts.push({ headers: req.headers, body: JSON.parse(body) });
      return json({ run_id: `h-${this.port}-${++this.n}`, status: "started", replayed: false });
    }
    const m = /^\/v1\/runs\/([^/]+)(\/events|\/stop)?$/.exec(url);
    if (!m) return void res.writeHead(404).end();
    const id = m[1]!;
    if (m[2] === "/stop") { this.stops.push(id); return json({ status: "stopping" }); }
    if (m[2] === "/events") {
      this.opens[id] = (this.opens[id] ?? 0) + 1;
      res.writeHead(200, { "content-type": "text/event-stream" });
      this.open.add(res);
      res.on("close", () => this.open.delete(res));
      return this.events(id, this.opens[id]!, res);
    }
    this.gets.push(id);
    return json({ run_id: id, ...(this.info[id] ?? { status: "running" }) });
  }

  async close() {
    for (const r of this.open) r.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

export const row = (over: Partial<PendingRun> & { runId: string }): PendingRun => ({
  workspace: "real", kind: "chat", input: "SECRET-INPUT", conversationId: "conv1", stopRequested: false,
  hermesRunId: undefined, status: "queued", lastSeq: undefined, ...over,
});

export class FakeConvex implements RelayConvex {
  startedCalls: { runId: string; hermesRunId: string }[] = [];
  eventCalls: { runId: string; events: { event: string; data: Record<string, unknown>; t: number; seq: number }[] }[] = [];
  finishedCalls: { runId: string; status: string }[] = [];
  activityCalls: { workspace: string; events: unknown[] }[] = [];
  startedResult = true;
  onFinished: (runId: string) => void = () => {};
  subscribePending() { return () => {}; }
  async started(runId: string, hermesRunId: string) { this.startedCalls.push({ runId, hermesRunId }); return { started: this.startedResult }; }
  async events(runId: string, events: FakeConvex["eventCalls"][number]["events"]) { this.eventCalls.push({ runId, events }); }
  async finished(runId: string, status: "completed" | "cancelled" | "failed") { this.finishedCalls.push({ runId, status }); this.onFinished(runId); }
  async activity(workspace: "real" | "demo", events: unknown[]) { this.activityCalls.push({ workspace, events }); }
  seqs(runId: string) { return this.eventCalls.filter((c) => c.runId === runId).flatMap((c) => c.events.map((e) => e.seq)); }
  names(runId: string) { return this.eventCalls.filter((c) => c.runId === runId).flatMap((c) => c.events.map((e) => e.event)); }
}

export async function waitFor(cond: () => boolean, what = "condition", ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
