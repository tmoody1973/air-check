import { describe, expect, test } from "vitest";
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
