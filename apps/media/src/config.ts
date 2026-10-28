export interface MediaConfig { convexUrl: string; mediaToken: string; inboxDir: string; preparedDir: string; pollMs: number; maxPrepared: number }

/** At most this many prepared MP3s wait for review at once; the rest wait in the inbox. */
export const MAX_PREPARED = 3;

/** Reads env. Throws (never echoing a value) when required settings are missing. */
export function loadConfig(env: Record<string, string | undefined>): MediaConfig {
  const mediaToken = env.MEDIA_TOKEN ?? "";
  if (mediaToken.length < 32) throw new Error("MEDIA_TOKEN is required and must be at least 32 characters");
  const convexUrl = env.CONVEX_URL?.trim();
  if (!convexUrl) throw new Error("CONVEX_URL is required");
  const poll = Number(env.POLL_MS);
  return {
    convexUrl, mediaToken, maxPrepared: MAX_PREPARED,
    inboxDir: env.INBOX_DIR?.trim() || "/home/user/aircheck-audio/inbox",
    preparedDir: env.PREPARED_DIR?.trim() || "/home/user/aircheck-audio/prepared",
    pollMs: Number.isFinite(poll) && poll >= 1000 ? poll : 30_000,
  };
}
