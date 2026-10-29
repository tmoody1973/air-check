import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const env = {
  BRIDGE_HOST: "10.104.0.41",
  BRIDGE_PORT: "8443",
  TLS_CERT: "/home/u/.aircheck/tls.crt",
  TLS_KEY: "/home/u/.aircheck/tls.key",
  CRATE_DIR: "/home/u/crate-cli",
  CRATE_MCP_TOKEN: "c".repeat(32),
  AIRCHECK_MCP_TOKEN: "a".repeat(32),
  CONVEX_SITE_URL: "https://optimistic-lobster-654.convex.site",
  AGENT_SUBMIT_TOKEN: "s".repeat(32),
};

describe("loadConfig", () => {
  it("reads a complete environment", () => {
    const c = loadConfig(env);
    expect(c.host).toBe("10.104.0.41");
    expect(c.port).toBe(8443);
    expect(c.crate).toMatchObject({ args: ["dist/mcp-server.js"], cwd: "/home/u/crate-cli", timeoutMs: 30_000 });
  });

  it.each(Object.keys(env))("names a missing %s", (name) => {
    expect(() => loadConfig({ ...env, [name]: undefined })).toThrow(name);
  });

  it.each(["CRATE_MCP_TOKEN", "AIRCHECK_MCP_TOKEN", "AGENT_SUBMIT_TOKEN"])("rejects a short %s", (name) => {
    expect(() => loadConfig({ ...env, [name]: "x".repeat(31) })).toThrow(name);
  });

  it.each([
    ["CRATE_MCP_TOKEN", "AIRCHECK_MCP_TOKEN"],
    ["CRATE_MCP_TOKEN", "AGENT_SUBMIT_TOKEN"],
    ["AIRCHECK_MCP_TOKEN", "AGENT_SUBMIT_TOKEN"],
  ])("rejects %s equal to %s", (a, b) => {
    const same = "z".repeat(40);
    expect(() => loadConfig({ ...env, [a]: same, [b]: same })).toThrow(/must differ/);
  });

  it.each(["0.0.0.0", "::", "[::]", "  "])("rejects the wildcard host %j", (host) => {
    expect(() => loadConfig({ ...env, BRIDGE_HOST: host })).toThrow("BRIDGE_HOST");
  });

  it("rejects a bad port", () => {
    expect(() => loadConfig({ ...env, BRIDGE_PORT: "84x3" })).toThrow("BRIDGE_PORT");
  });

  it("rejects a non-https Convex URL", () => {
    expect(() => loadConfig({ ...env, CONVEX_SITE_URL: "http://x.convex.site" })).toThrow("CONVEX_SITE_URL");
  });

  it("reads TAVILY_API_KEY as optional", () => {
    expect(loadConfig(env).tavilyApiKey).toBeUndefined();
    expect(loadConfig({ ...env, TAVILY_API_KEY: "  " }).tavilyApiKey).toBeUndefined();
    expect(loadConfig({ ...env, TAVILY_API_KEY: " tvly-abc " }).tavilyApiKey).toBe("tvly-abc");
  });

  describe("demo sandbox tokens", () => {
    const demo = { AIRCHECK_DEMO_MCP_TOKEN: "d".repeat(32), DEMO_AGENT_SUBMIT_TOKEN: "m".repeat(32) };

    it("are absent by default", () => {
      const c = loadConfig(env);
      expect(c.demoMcpToken).toBeUndefined();
      expect(c.demoSubmitToken).toBeUndefined();
    });

    it("load as a pair", () => {
      const c = loadConfig({ ...env, ...demo });
      expect(c.demoMcpToken).toBe(demo.AIRCHECK_DEMO_MCP_TOKEN);
      expect(c.demoSubmitToken).toBe(demo.DEMO_AGENT_SUBMIT_TOKEN);
    });

    it.each(Object.keys(demo))("throw when only %s is set", (name) => {
      expect(() => loadConfig({ ...env, [name]: demo[name as keyof typeof demo] })).toThrow(name);
    });

    it.each(Object.keys(demo))("reject a short %s", (name) => {
      expect(() => loadConfig({ ...env, ...demo, [name]: "x".repeat(31) })).toThrow(name);
    });

    it.each(["CRATE_MCP_TOKEN", "AIRCHECK_MCP_TOKEN", "AGENT_SUBMIT_TOKEN"])("reject a demo token equal to %s", (name) => {
      const same = env[name as keyof typeof env];
      expect(() => loadConfig({ ...env, ...demo, AIRCHECK_DEMO_MCP_TOKEN: same })).toThrow(/must differ/);
      expect(() => loadConfig({ ...env, ...demo, DEMO_AGENT_SUBMIT_TOKEN: same })).toThrow(/must differ/);
    });

    it("reject the two demo tokens equal to each other", () => {
      const same = "q".repeat(40);
      expect(() => loadConfig({ ...env, AIRCHECK_DEMO_MCP_TOKEN: same, DEMO_AGENT_SUBMIT_TOKEN: same })).toThrow(/must differ/);
    });
  });
});
