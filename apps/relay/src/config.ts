export interface SandboxConfig { name: string; workspace: "real" | "demo"; port: number; token: string }
export interface RelayConfig { convexUrl: string; relayToken: string; nemohermesBin: string; sandboxes: SandboxConfig[] }

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
  return { convexUrl, relayToken, nemohermesBin: env.NEMOHERMES_BIN || "/home/user/.local/bin/nemohermes", sandboxes };
}
