import { describe, expect, test } from "vitest";
import { ENCODE_TIMEOUT_MS, PROBE_TIMEOUT_MS, execOptions } from "../src/encode.js";
import { loadConfig } from "../src/config.js";

const base = { CONVEX_URL: "https://x.convex.cloud", MEDIA_TOKEN: "m".repeat(32) };

describe("loadConfig", () => {
  test("applies defaults", () => {
    expect(loadConfig(base)).toMatchObject({ inboxDir: "/home/user/aircheck-audio/inbox", pollMs: 30_000, maxPrepared: 3 });
  });
  test("rejects a short token without echoing it", () => {
    expect(() => loadConfig({ ...base, MEDIA_TOKEN: "short" })).toThrow(/at least 32/);
  });
  test("requires CONVEX_URL", () => {
    expect(() => loadConfig({ MEDIA_TOKEN: base.MEDIA_TOKEN })).toThrow(/CONVEX_URL/);
  });
});

describe("execOptions", () => {
  test("kills ffmpeg after 30 minutes and ffprobe after 1 minute", () => {
    expect(execOptions("ffmpeg")).toMatchObject({ timeout: ENCODE_TIMEOUT_MS, killSignal: "SIGKILL" });
    expect(execOptions("ffprobe")).toMatchObject({ timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL" });
    expect(ENCODE_TIMEOUT_MS).toBe(30 * 60_000);
    expect(PROBE_TIMEOUT_MS).toBe(60_000);
  });
});

describe("connectConvex (M5)", () => {
  test("a Convex call that never answers fails after the timeout instead of wedging the pass", async () => {
    const { createServer } = await import("node:http");
    const { connectConvex } = await import("../src/convex.js");
    const server = createServer(() => {}); // accepts, never answers
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      const t0 = Date.now();
      await expect(connectConvex(`http://127.0.0.1:${port}`, "t".repeat(48), 200).pending()).rejects.toThrow();
      expect(Date.now() - t0).toBeLessThan(5_000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
