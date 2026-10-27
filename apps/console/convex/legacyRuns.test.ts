// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Plan-3-era run rows have only workspace, runId, title, state, upcoming, updatedAt. Convex refuses to deploy
// a schema those rows violate, so every Plan 4b field is optional and every reader must cope.
const modules = import.meta.glob("./**/*.*s");
const RELAY = "r".repeat(40);
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo", sid: "s1" };
const state = { runId: "old", status: "running", steps: [] };

beforeEach(() => vi.stubEnv("RELAY_TOKEN", RELAY));
afterEach(() => vi.unstubAllEnvs());

const legacy = (workspace: "real" | "demo", runId: string) => ({ workspace, runId, title: "Old", state: { ...state, runId }, upcoming: [], updatedAt: 1 });

test("old run rows: get, requestStop, relay.pending and the demo limits do not throw", async () => {
  vi.stubEnv("DEMO_RUNS_PER_SESSION", "1");
  vi.stubEnv("DEMO_LIVE_RUNS_PER_DAY", "1");
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("runs", legacy("real", "old-real"));
    await ctx.db.insert("runs", legacy("demo", "old-demo"));
  });
  const me = t.withIdentity(human);

  const got = await me.query(api.runs.get, { runId: "old-real" });
  expect(got).toMatchObject({ runId: "old-real", status: "running", stopRequested: false, source: "live" });

  expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([]);

  // a finished legacy row is a no-op; a running one falls back to state.status
  await t.run(async (ctx) => {
    await ctx.db.insert("runs", { ...legacy("real", "old-done"), state: { ...state, runId: "old-done", status: "completed" } });
  });
  await me.mutation(api.runs.requestStop, { runId: "old-done" });
  expect((await t.run((ctx) => ctx.db.query("runs").collect())).find((r) => r.runId === "old-done")).toMatchObject({ state: { status: "completed" } });
  await me.mutation(api.runs.requestStop, { runId: "old-real" });
  expect(await t.query(api.relay.pending, { token: RELAY })).toEqual([]); // still has no status/input/kind, so never handed to the relay

  // old demo rows count for nothing: a new demo run is still live and not rate limited
  const first = await t.withIdentity(demo).mutation(api.chat.send, { text: "hi" });
  expect((await t.run((ctx) => ctx.db.query("runs").collect())).find((r) => r.runId === first.runId)).toMatchObject({ source: "live" });
  await expect(t.withIdentity(demo).mutation(api.chat.send, { text: "again" })).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } });
});

test("relay.events / finished on an old row do not throw", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("runs", legacy("real", "old")));
  await t.mutation(api.relay.finished, { token: RELAY, runId: "old", status: "failed" });
  await t.mutation(api.relay.events, { token: RELAY, runId: "old", events: [{ event: "message.delta", data: { delta: "x" }, t: 1, seq: 1 }] });
});
