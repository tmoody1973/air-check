import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { CONVEX_URL: "https://x.convex.cloud", RELAY_TOKEN: "r".repeat(32), AIRC_GATEWAY_TOKEN: "a-token", AIRCDEMO_GATEWAY_TOKEN: "d-token" };

describe("loadConfig", () => {
  test("lists both sandboxes with their ports and the default nemohermes path", () => {
    const c = loadConfig(base);
    expect(c.sandboxes).toEqual([
      { name: "airc", workspace: "real", port: 8642, token: "a-token" },
      { name: "aircdemo", workspace: "demo", port: 8643, token: "d-token" },
    ]);
    expect(c.nemohermesBin).toBe("/home/user/.local/bin/nemohermes");
  });
  test("skips a sandbox whose token is empty", () => {
    expect(loadConfig({ ...base, AIRCDEMO_GATEWAY_TOKEN: "" }).sandboxes.map((s) => s.name)).toEqual(["airc"]);
  });
  test.each([[{ RELAY_TOKEN: "short" }], [{ RELAY_TOKEN: undefined }], [{ CONVEX_URL: undefined }]])("rejects bad env %j", (over) => {
    expect(() => loadConfig({ ...base, ...over })).toThrow(/RELAY_TOKEN|CONVEX_URL/);
  });
  test("the error never contains the token value", () => {
    try { loadConfig({ ...base, RELAY_TOKEN: "supersecret" }); } catch (e) { expect(String(e)).not.toContain("supersecret"); }
  });
});
