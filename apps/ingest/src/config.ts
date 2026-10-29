export interface BoxCreds { clientId: string; clientSecret: string; enterpriseId: string; folderId: string }
export interface AppCreds { clientId: string; clientSecret: string }

export interface IngestConfig {
  convexUrl: string; ingestToken: string;
  tokenDir: string; inboxDir: string; preparedDir: string;
  scanMs: number; pollMs: number;
  /** null: not configured; that source reports not_connected and is skipped. */
  box: BoxCreds | null; google: AppCreds | null; dropbox: AppCreds | null;
  /** Dropbox folder holding the Paper docs ("" = the whole Dropbox; slow on a large account). */
  dropboxFolder: string;
}

const ms = (raw: string | undefined, min: number, fallback: number) => {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= min ? n : fallback;
};
const both = (id: string | undefined, secret: string | undefined): AppCreds | null =>
  id?.trim() && secret?.trim() ? { clientId: id.trim(), clientSecret: secret.trim() } : null;

/** Reads env. Throws (never echoing a value) when required settings are missing. Source credentials are optional. */
export function loadConfig(env: Record<string, string | undefined>): IngestConfig {
  const ingestToken = env.INGEST_TOKEN ?? "";
  if (ingestToken.length < 32) throw new Error("INGEST_TOKEN is required and must be at least 32 characters");
  const convexUrl = env.CONVEX_URL?.trim();
  if (!convexUrl) throw new Error("CONVEX_URL is required");
  const folderId = env.BOX_FOLDER_ID?.trim() ?? "";
  if (folderId && !/^\d+$/.test(folderId)) throw new Error("BOX_FOLDER_ID must be a Box folder id (digits only)");
  const box = both(env.BOX_CLIENT_ID, env.BOX_CLIENT_SECRET);
  const enterpriseId = env.BOX_ENTERPRISE_ID?.trim();
  const dropboxFolder = (env.DROPBOX_FOLDER?.trim() ?? "").replace(/\/+$/, "");
  if (dropboxFolder && !dropboxFolder.startsWith("/")) throw new Error("DROPBOX_FOLDER must start with / (or be empty)");
  return {
    convexUrl, ingestToken,
    tokenDir: env.INGEST_TOKEN_DIR?.trim() || "/home/user/.aircheck/ingest-tokens",
    inboxDir: env.INBOX_DIR?.trim() || "/home/user/aircheck-audio/inbox",
    preparedDir: env.PREPARED_DIR?.trim() || "/home/user/aircheck-audio/prepared",
    scanMs: ms(env.SCAN_MS, 60_000, 3_600_000),
    pollMs: ms(env.POLL_MS, 1000, 60_000),
    box: box && enterpriseId && folderId ? { ...box, enterpriseId, folderId } : null,
    google: both(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    dropbox: both(env.DROPBOX_APP_KEY, env.DROPBOX_APP_SECRET),
    dropboxFolder,
  };
}
