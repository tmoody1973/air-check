import type { CrateProxyOptions } from "./crateProxy.js";

export interface BridgeConfig {
  host: string;
  port: number;
  tlsCert: string; // path to the PEM certificate
  tlsKey: string; // path to the PEM private key
  crate: CrateProxyOptions;
  crateMcpToken: string;
  aircheckMcpToken: string;
  convexSiteUrl: string;
  agentSubmitToken: string;
}

const MIN_TOKEN = 32;

/** Reads the bridge's environment. Errors name the variable, never its value. */
export function loadConfig(env: Record<string, string | undefined>): BridgeConfig {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`Missing ${k}`);
    return v;
  };
  const token = (k: string) => {
    const v = need(k);
    if (v.length < MIN_TOKEN) throw new Error(`${k} must be at least ${MIN_TOKEN} characters`);
    return v;
  };

  const port = Number(need("BRIDGE_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("BRIDGE_PORT must be a port number");
  const convexSiteUrl = need("CONVEX_SITE_URL");
  if (!URL.canParse(convexSiteUrl) || new URL(convexSiteUrl).protocol !== "https:")
    throw new Error("CONVEX_SITE_URL must be an https URL");

  return {
    host: need("BRIDGE_HOST"),
    port,
    tlsCert: need("TLS_CERT"),
    tlsKey: need("TLS_KEY"),
    // Crate runs on the same Node as the bridge, so systemd's PATH does not matter.
    crate: { command: process.execPath, args: ["dist/mcp-server.js"], cwd: need("CRATE_DIR"), timeoutMs: 30_000 },
    crateMcpToken: token("CRATE_MCP_TOKEN"),
    aircheckMcpToken: token("AIRCHECK_MCP_TOKEN"),
    convexSiteUrl,
    agentSubmitToken: token("AGENT_SUBMIT_TOKEN"),
  };
}
