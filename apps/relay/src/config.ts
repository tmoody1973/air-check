export interface SandboxConfig { name: string; workspace: "real" | "demo"; port: number; token: string }
export interface RelayConfig {
  convexUrl: string; relayToken: string; nemohermesBin: string; sandboxes: SandboxConfig[];
  /** Oct 29 prefetch: the bridge's address and each workspace's MCP token. Unset means the agent's first call starts it. */
  bridge?: { url: string; tokens: { real?: string; demo?: string } };
}

const SANDBOXES = [
  { name: "airc", workspace: "real", port: 8642, tokenEnv: "AIRC_GATEWAY_TOKEN" },
  { name: "aircdemo", workspace: "demo", port: 8643, tokenEnv: "AIRCDEMO_GATEWAY_TOKEN" },
] as const;

/** Reads env. Throws (never echoing a value) when required settings are missing. A sandbox with an empty token is skipped. */
export function loadConfig(env: Record<string, string | undefined>): RelayConfig {
  const relayToken = env.RELAY_TOKEN ?? "";
  if (relayToken.length < 32) throw new Error("RELAY_TOKEN is required and must be at least 32 characters");
  const convexUrl = env.CONVEX_URL?.trim();
  if (!convexUrl) throw new Error("CONVEX_URL is required");
  const sandboxes = SANDBOXES.flatMap((s) => {
    const token = env[s.tokenEnv]?.trim();
    return token ? [{ name: s.name, workspace: s.workspace, port: s.port, token }] : [];
  });
  const bridgeUrl = env.BRIDGE_URL?.trim();
  if (bridgeUrl && !URL.canParse(bridgeUrl)) throw new Error("BRIDGE_URL must be a URL");
  const real = env.AIRCHECK_MCP_TOKEN?.trim();
  const demo = env.AIRCHECK_DEMO_MCP_TOKEN?.trim();
  const bridge = bridgeUrl ? { url: bridgeUrl, tokens: { ...(real && { real }), ...(demo && { demo }) } } : undefined;
  return { convexUrl, relayToken, nemohermesBin: env.NEMOHERMES_BIN || "/home/user/.local/bin/nemohermes", sandboxes, ...(bridge && { bridge }) };
}
