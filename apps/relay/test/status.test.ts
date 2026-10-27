import { describe, expect, test } from "vitest";
import { pollStatus, type ExecText } from "../src/status.js";
import { FakeConvex } from "./helpers.js";

const STATUS = "Sandbox:\n  Name: airc\n  Phase: Ready\n";
const POLICY = "network:\n  - host: a.example\n  - host: b.example\n  - host: a.example\n";

function harness(exec: ExecText) {
  const convex = new FakeConvex();
  const logs: string[] = [];
  const sandboxes = [{ name: "airc", workspace: "real" as const }, { name: "aircdemo", workspace: "demo" as const }];
  const poller = pollStatus({ sandboxes, bin: "/bin/nh", convex, exec, log: (l) => logs.push(l), everyMs: 1_000_000 });
  return { convex, logs, poller };
}

describe("pollStatus", () => {
  test("polls once at start with status and policy get, then sends parsed values per workspace", async () => {
    const calls: string[][] = [];
    const exec: ExecText = async (bin, args, timeoutMs) => {
      calls.push([bin, ...args, String(timeoutMs)]);
      return args[1] === "status" ? STATUS : POLICY;
    };
    const h = harness(exec);
    await h.poller.ready;
    h.poller.stop();
    expect(calls).toContainEqual(["/bin/nh", "airc", "status", "30000"]);
    expect(calls).toContainEqual(["/bin/nh", "airc", "policy", "get", "30000"]);
    expect(h.convex.statusCalls).toEqual([
      { workspace: "real", phase: "Ready", allowedHosts: 2 },
      { workspace: "demo", phase: "Ready", allowedHosts: 2 },
    ]);
    expect(h.logs).toContain("status sandbox=airc phase=Ready hosts=2");
  });

  test("a failing sandbox is logged, never throws, and does not block the other", async () => {
    const exec: ExecText = async (_b, args) => {
      if (args[0] === "airc") throw new Error("SECRET-OUTPUT boom");
      return args[1] === "status" ? STATUS : POLICY;
    };
    const h = harness(exec);
    await h.poller.ready;
    h.poller.stop();
    expect(h.logs).toContain("status sandbox=airc ok=false");
    expect(h.convex.statusCalls.map((c) => c.workspace)).toEqual(["demo"]);
    expect(h.logs.join("\n")).not.toContain("SECRET");
  });

  test("a convex failure is logged as ok=false and does not throw", async () => {
    const h = harness(async (_b, args) => (args[1] === "status" ? STATUS : POLICY));
    h.convex.status = async () => { throw new Error("down"); };
    await h.poller.ready;
    h.poller.stop();
    expect(h.logs.filter((l) => l === "status sandbox=airc ok=false")).toHaveLength(1);
  });

  test("polls again on the interval and stops cleanly", async () => {
    const calls: string[] = [];
    const convex = new FakeConvex();
    const p = pollStatus({ sandboxes: [{ name: "airc", workspace: "real" }], bin: "b", convex, log: () => {}, everyMs: 10, exec: async (_b, a) => { calls.push(a[1]!); return a[1] === "status" ? STATUS : POLICY; } });
    await new Promise((r) => setTimeout(r, 60));
    p.stop();
    const n = convex.statusCalls.length;
    expect(n).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 40));
    expect(convex.statusCalls.length).toBe(n);
  });
});
