// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", email: "demo@example.com", emailVerified: true, role: "demo" };
const state = { runId: "r-real", status: "running", steps: [] };

describe("runs.get", () => {
  test("is workspace-isolated and null without an actor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("runs", { workspace: "real", runId: "r-real", title: "Real run", state, updatedAt: 1 });
      await ctx.db.insert("runs", {
        workspace: "demo", runId: "r-demo", title: "Demo run", state: { ...state, runId: "r-demo" }, updatedAt: 1,
        upcoming: [{ label: "H1.7", text: "x", status: "next" }],
      });
    });
    expect(await t.query(api.runs.get, { runId: "r-real" })).toBeNull();
    expect(await t.withIdentity(human).query(api.runs.get, { runId: "r-real" })).toEqual({ runId: "r-real", title: "Real run", state, upcoming: undefined });
    expect(await t.withIdentity(demo).query(api.runs.get, { runId: "r-real" })).toBeNull();
    expect(await t.withIdentity(human).query(api.runs.get, { runId: "r-demo" })).toBeNull();
    expect((await t.withIdentity(demo).query(api.runs.get, { runId: "r-demo" }))?.upcoming).toHaveLength(1);
    expect(await t.withIdentity(human).query(api.runs.get, { runId: "nope" })).toBeNull();
  });
});
