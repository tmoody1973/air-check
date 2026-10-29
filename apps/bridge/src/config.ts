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
  /** Demo sandbox pair: both set or both absent. Absent means no /aircheck-demo/mcp route. */
  demoMcpToken?: string;
  demoSubmitToken?: string;
  /** Tavily key for source_search (Plan 7). Optional: absent means source_search says web search is not configured. */
  tavilyApiKey?: string;
}

const MIN_TOKEN = 32;
const WILDCARD_HOSTS = ["0.0.0.0", "::", "[::]"];

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

  const host = need("BRIDGE_HOST");
  // The bridge binds one specific address (10.104.0.41 on the VM), never every interface.
  if (WILDCARD_HOSTS.includes(host)) throw new Error("BRIDGE_HOST must be a specific address, not a wildcard");
  const demoNames = ["AIRCHECK_DEMO_MCP_TOKEN", "DEMO_AGENT_SUBMIT_TOKEN"] as const;
  const demoSet = demoNames.filter((k) => env[k]?.trim());
  if (demoSet.length === 1)
    throw new Error(`${demoNames.join(" and ")} must be set together (only ${demoSet[0]} is set)`);
  const names = ["CRATE_MCP_TOKEN", "AIRCHECK_MCP_TOKEN", "AGENT_SUBMIT_TOKEN", ...(demoSet.length ? demoNames : [])];
  const tokens = names.map(token);
  if (new Set(tokens).size !== tokens.length) throw new Error(`${names.join(", ")} must differ`);
  const [crateMcpToken, aircheckMcpToken, agentSubmitToken, demoMcpToken, demoSubmitToken] = tokens as [
    string,
    string,
    string,
    string | undefined,
    string | undefined,
  ];

  return {
    host,
    port,
    tlsCert: need("TLS_CERT"),
    tlsKey: need("TLS_KEY"),
    // Crate runs on the same Node as the bridge, so systemd's PATH does not matter.
    crate: { command: process.execPath, args: ["dist/mcp-server.js"], cwd: need("CRATE_DIR"), timeoutMs: 30_000 },
    crateMcpToken,
    aircheckMcpToken,
    convexSiteUrl,
    agentSubmitToken,
    demoMcpToken,
    demoSubmitToken,
    tavilyApiKey: env.TAVILY_API_KEY?.trim() || undefined,
  };
}
