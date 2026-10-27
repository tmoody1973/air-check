import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { followAudit, type SpawnLogs } from "../src/audit.js";
import { FakeConvex, waitFor } from "./helpers.js";

const DENIED = "[1793105781.120] sandbox NET:OPEN [MED] DENIED /usr/bin/python3.13(226) -> evil.example:443 [policy:- engine:opa] [reason:no policy]";
const ALLOWED = "[1793105782.000] sandbox NET:OPEN [MED] ALLOWED /usr/bin/node(9) -> api.example.com:443 [policy:x engine:opa]";

function harness() {
  const convex = new FakeConvex();
  const logs: string[] = [];
  const children: PassThrough[] = [];
  const killed: number[] = [];
  const spawned: string[][] = [];
  const spawn: SpawnLogs = (bin, args) => {
    spawned.push([bin, ...args]);
    const out = new PassThrough();
    children.push(out);
    const idx = children.length - 1;
    return { stdout: out, onExit: (cb) => { out.once("close", () => cb()); }, kill: () => { killed.push(idx); } };
  };
  return { convex, logs, children, spawned, spawn, killed };
}

describe("followAudit", () => {
  test("parses lines, counts skipped ones, and batches activity under the sandbox's workspace", async () => {
    const h = harness();
    const f = followAudit({ name: "aircdemo", workspace: "demo", bin: "/bin/nemohermes", convex: h.convex, spawn: h.spawn, log: (l) => h.logs.push(l), flushMs: 10, backoffMs: () => 1 });
    await waitFor(() => h.children.length === 1);
    h.children[0]!.write(`${DENIED}\nsome unrelated line\n\n${ALLOWED}\n`);
    await waitFor(() => h.convex.activityCalls.length > 0);
    expect(h.spawned[0]).toEqual(["/bin/nemohermes", "aircdemo", "logs", "--follow"]);
    expect(h.convex.activityCalls.flatMap((c) => c.events)).toHaveLength(2);
    expect(h.convex.activityCalls[0]!.workspace).toBe("demo");
    expect(h.logs.join("\n")).toMatch(/audit sandbox=aircdemo parsed=2 skipped=1/);
    expect(h.logs.join("\n")).not.toContain("evil.example");
    f.stop();
  });

  test("restarts the follower after the child exits", async () => {
    const h = harness();
    const f = followAudit({ name: "airc", workspace: "real", bin: "nh", convex: h.convex, spawn: h.spawn, log: () => {}, flushMs: 10, backoffMs: () => 1 });
    await waitFor(() => h.children.length === 1);
    h.children[0]!.end();
    await waitFor(() => h.children.length === 2, "respawn");
    h.children[1]!.write(`${DENIED}\n`);
    await waitFor(() => h.convex.activityCalls.length === 1);
    f.stop();
  });

  test("a Convex failure does not crash the follower", async () => {
    const h = harness();
    h.convex.activity = async () => { throw new Error("down"); };
    const f = followAudit({ name: "airc", workspace: "real", bin: "nh", convex: h.convex, spawn: h.spawn, log: (l) => h.logs.push(l), flushMs: 10, backoffMs: () => 1 });
    await waitFor(() => h.children.length === 1);
    h.children[0]!.write(`${DENIED}\n`);
    await waitFor(() => h.logs.some((l) => l.includes("activity_failed")));
    f.stop();
  });

  test("stop() kills the child and flushes buffered events", async () => {
    const h = harness();
    const f = followAudit({ name: "airc", workspace: "real", bin: "nh", convex: h.convex, spawn: h.spawn, log: () => {}, flushMs: 60_000, backoffMs: () => 1 });
    await waitFor(() => h.children.length === 1);
    h.children[0]!.write(`${DENIED}\n`);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.convex.activityCalls).toEqual([]);
    f.stop();
    await waitFor(() => h.convex.activityCalls.length === 1, "flush on stop");
    expect(h.killed).toEqual([0]);
  });

  test("a failed flush is retried on its own timer", async () => {
    const h = harness();
    let fail = true;
    const orig = h.convex.activity.bind(h.convex);
    h.convex.activity = async (w, e) => { if (fail) { fail = false; throw new Error("down"); } return orig(w, e); };
    const f = followAudit({ name: "airc", workspace: "real", bin: "nh", convex: h.convex, spawn: h.spawn, log: () => {}, flushMs: 10, backoffMs: () => 1 });
    await waitFor(() => h.children.length === 1);
    h.children[0]!.write(`${DENIED}\n`);
    await waitFor(() => h.convex.activityCalls.length === 1, "retry without new lines");
    f.stop();
  });

  test("sends at most 500 events per relay.activity call", async () => {
    const h = harness();
    const f = followAudit({ name: "airc", workspace: "real", bin: "nh", convex: h.convex, spawn: h.spawn, log: () => {}, flushMs: 50, backoffMs: () => 1 });
    await waitFor(() => h.children.length === 1);
    h.children[0]!.write(Array.from({ length: 1100 }, (_, i) => `[1793105781.120] x NET:OPEN [MED] DENIED /usr/bin/p(1) -> h${i}.example:443 [policy:- engine:opa] [reason:r]`).join("\n") + "\n");
    await waitFor(() => h.convex.activityCalls.flatMap((c) => c.events).length === 1100);
    expect(h.convex.activityCalls.map((c) => c.events.length)).toEqual([500, 500, 100]);
    f.stop();
  });
});
