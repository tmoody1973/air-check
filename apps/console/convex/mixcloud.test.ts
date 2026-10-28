// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const human = { subject: "u1", email: "dj@radiomilwaukee.org", emailVerified: true };
const demo = { subject: "d1", role: "demo" };

beforeEach(() => vi.stubEnv("PUBLISHER_TOKEN", "p".repeat(48)));
afterEach(() => vi.unstubAllEnvs());

describe("mixcloud status", () => {
  test("reads not_connected before anything is written", async () => {
    const t = convexTest(schema, modules);
    expect(await t.withIdentity(human).query(api.mixcloud.get, {})).toEqual({ state: "not_connected" });
  });

  test("a signed-in human records the connection; the publisher can flag it for reconnect", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    await as.mutation(api.mixcloud.connected, { account: "rhythmlab" });
    expect(await as.query(api.mixcloud.get, {})).toEqual({ state: "connected", account: "rhythmlab", connectedAt: expect.any(Number) });
    await t.mutation(api.publisher.setMixcloud, { token: "p".repeat(48), state: "needs_reconnect", account: "rhythmlab", lastError: "invalid_token" });
    expect(await as.query(api.mixcloud.get, {})).toMatchObject({ state: "needs_reconnect", lastError: "invalid_token" });
    await as.mutation(api.mixcloud.connected, { account: "rhythmlab" });
    expect(await as.query(api.mixcloud.get, {})).not.toHaveProperty("lastError");
    expect(await t.run((ctx) => ctx.db.query("mixcloudStatus").collect())).toHaveLength(1);
  });

  test("anonymous and demo callers cannot connect or read it", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.mixcloud.connected, { account: "x" })).rejects.toThrow();
    await expect(t.withIdentity(demo).mutation(api.mixcloud.connected, { account: "x" })).rejects.toThrow();
    await t.withIdentity(human).mutation(api.mixcloud.connected, { account: "rhythmlab" });
    expect(await t.query(api.mixcloud.get, {})).toBeNull();
    expect(await t.withIdentity(demo).query(api.mixcloud.get, {})).toBeNull();
  });
  test("a signed-in human disconnects: state not_connected, account and error cleared", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(human);
    await as.mutation(api.mixcloud.connected, { account: "rhythmlab" });
    await t.mutation(api.publisher.setMixcloud, { token: "p".repeat(48), state: "needs_reconnect", account: "rhythmlab", lastError: "invalid_token" });
    await as.mutation(api.mixcloud.disconnected, {});
    expect(await as.query(api.mixcloud.get, {})).toEqual({ state: "not_connected" });
    expect(await t.run((ctx) => ctx.db.query("mixcloudStatus").collect())).toHaveLength(1);
  });

  test("anonymous and demo callers cannot disconnect", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(human).mutation(api.mixcloud.connected, { account: "rhythmlab" });
    await expect(t.mutation(api.mixcloud.disconnected, {})).rejects.toThrow();
    await expect(t.withIdentity(demo).mutation(api.mixcloud.disconnected, {})).rejects.toThrow();
    expect(await t.withIdentity(human).query(api.mixcloud.get, {})).toMatchObject({ state: "connected" });
  });
});
