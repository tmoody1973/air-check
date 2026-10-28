export interface PublisherConfig {
  convexUrl: string; publisherToken: string; appUrl: string;
  tokenFile: string; preparedDir: string; stateFile: string; secretsFile: string; pollMs: number;
}

/** Reads env. Throws (never echoing a value) when required settings are missing. */
export function loadConfig(env: Record<string, string | undefined>): PublisherConfig {
  const publisherToken = env.PUBLISHER_TOKEN ?? "";
  if (publisherToken.length < 32) throw new Error("PUBLISHER_TOKEN is required and must be at least 32 characters");
  const convexUrl = env.CONVEX_URL?.trim();
  if (!convexUrl) throw new Error("CONVEX_URL is required");
  const appUrl = env.APP_URL?.trim();
  if (!appUrl) throw new Error("APP_URL is required (the console's address, for the review link)");
  const poll = Number(env.POLL_MS);
  return {
    convexUrl, publisherToken, appUrl,
    tokenFile: env.MIXCLOUD_TOKEN_FILE?.trim() || "/home/user/.aircheck/mixcloud/token.json",
    preparedDir: env.PREPARED_DIR?.trim() || "/home/user/aircheck-audio/prepared",
    stateFile: env.STATE_FILE?.trim() || "/home/user/.aircheck/publisher-state.json",
    secretsFile: env.AIRC_SECRETS_FILE?.trim() || "/home/user/.airc/secrets.env",
    pollMs: Number.isFinite(poll) && poll >= 1000 ? poll : 30_000,
  };
}
