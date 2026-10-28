import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { CONVEX_URL: "https://x.convex.cloud", PUBLISHER_TOKEN: "p".repeat(32), APP_URL: "https://aircheck.example" };

describe("loadConfig", () => {
  test("applies defaults", () => {
    expect(loadConfig(base)).toEqual({
      convexUrl: base.CONVEX_URL, publisherToken: base.PUBLISHER_TOKEN, appUrl: base.APP_URL,
      tokenFile: "/home/user/.aircheck/mixcloud/token.json",
      preparedDir: "/home/user/aircheck-audio/prepared",
      stateFile: "/home/user/.aircheck/publisher-state.json",
      secretsFile: "/home/user/.airc/secrets.env",
      pollMs: 30_000,
    });
  });
  test("rejects a short token without echoing it", () => {
    expect(() => loadConfig({ ...base, PUBLISHER_TOKEN: "short-secret" })).toThrow(/at least 32/);
    try { loadConfig({ ...base, PUBLISHER_TOKEN: "short-secret" }); } catch (e) { expect(String(e)).not.toContain("short-secret"); }
  });
  test("requires CONVEX_URL and APP_URL", () => {
    expect(() => loadConfig({ ...base, CONVEX_URL: "" })).toThrow(/CONVEX_URL/);
    expect(() => loadConfig({ ...base, APP_URL: undefined })).toThrow(/APP_URL/);
  });
  test("honours overrides; POLL_MS below 1 s is ignored", () => {
    const c = loadConfig({ ...base, MIXCLOUD_TOKEN_FILE: "/t.json", PREPARED_DIR: "/p", STATE_FILE: "/s.json", AIRC_SECRETS_FILE: "/x.env", POLL_MS: "5000" });
    expect(c).toMatchObject({ tokenFile: "/t.json", preparedDir: "/p", stateFile: "/s.json", secretsFile: "/x.env", pollMs: 5000 });
    expect(loadConfig({ ...base, POLL_MS: "10" }).pollMs).toBe(30_000);
  });
});
