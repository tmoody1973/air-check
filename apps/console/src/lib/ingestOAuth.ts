import { join } from "node:path";
import { appOrigin } from "./app-origin";

// The console's half of Connect Google Drive and Connect Dropbox (server only), built like Connect Mixcloud. Only the
// refresh token is kept: it goes from the provider's answer straight into a token file that the ingest service reads,
// never into Convex, a log line or a URL. The access token in the same answer is dropped; ingest mints its own.
// Read-only scopes only (research §2, §3): Google drive.readonly, Dropbox files.metadata.read + files.content.read.

export type Provider = "google" | "dropbox";
export type IngestErrorReason = "state" | "denied" | "exchange" | "no_refresh" | "write" | "status" | "config";
export type IngestConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type IngestTokenFile = { refresh_token: string; account: string; connectedAt: number };

const SPEC = {
  google: {
    idEnv: "GOOGLE_CLIENT_ID", secretEnv: "GOOGLE_CLIENT_SECRET",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    // Without access_type=offline and prompt=consent Google sends no refresh token (research §2).
    params: { scope: "https://www.googleapis.com/auth/drive.readonly", access_type: "offline", prompt: "consent" },
    fallbackAccount: "Google account",
  },
  dropbox: {
    idEnv: "DROPBOX_APP_KEY", secretEnv: "DROPBOX_APP_SECRET",
    authorize: "https://www.dropbox.com/oauth2/authorize",
    token: "https://api.dropboxapi.com/oauth2/token",
    // ponytail: no account_info.read scope (research §3 says its need is unverified), so the label is generic.
    params: { token_access_type: "offline", scope: "files.metadata.read files.content.read" },
    fallbackAccount: "Dropbox account",
  },
} as const;

const TIMEOUT_MS = 15_000;
const COOKIE_ATTRS = (p: Provider) => `HttpOnly; Secure; SameSite=Lax; Path=/api/${p}`;

/** Null when any setting is missing. The redirect URI is built once here; both calls must send it identically. */
export function ingestConfig(p: Provider): IngestConfig | null {
  const clientId = process.env[SPEC[p].idEnv];
  const clientSecret = process.env[SPEC[p].secretEnv];
  const origin = appOrigin();
  if (!clientId || !clientSecret || !origin) return null;
  return { clientId, clientSecret, redirectUri: `${origin}/api/${p}/callback` };
}

export const tokenFilePath = (p: Provider) => join(process.env.INGEST_TOKEN_DIR || "/ingest-tokens", `${p}.json`);

export const stateCookieName = (p: Provider) => `${p}_oauth_state`;
export const stateCookie = (p: Provider, value: string) => `${stateCookieName(p)}=${value}; ${COOKIE_ATTRS(p)}; Max-Age=600`;
export const clearStateCookie = (p: Provider) => `${stateCookieName(p)}=; ${COOKIE_ATTRS(p)}; Max-Age=0`;

export const authorizeUrl = (p: Provider, cfg: IngestConfig, state: string) =>
  `${SPEC[p].authorize}?${new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", ...SPEC[p].params, state })}`;

export const errorLocation = (p: Provider, reason: IngestErrorReason) => `/settings?${p}=error&reason=${reason}`;

/**
 * The email claim of an OpenID id_token, for the Settings label only. The signature is NOT checked: nothing trusts this
 * value, it is display text. Google sends an id_token only when openid/email scopes are asked for, which we don't, so
 * this is usually null and the label falls back to "Google account".
 */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const email = (JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown> | null)?.email;
    return typeof email === "string" && email.length > 0 && email.length <= 200 ? email : null;
  } catch {
    return null;
  }
}

/** The refresh token and a display label, or a fixed reason code. The secret travels only in this POST body. */
export async function exchangeCode(
  p: Provider, cfg: IngestConfig, code: string,
): Promise<{ refreshToken: string; account: string } | "exchange" | "no_refresh"> {
  let body: Record<string, unknown> | null;
  try {
    const res = await fetch(SPEC[p].token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, grant_type: "authorization_code", redirect_uri: cfg.redirectUri }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return "exchange";
    body = (await res.json()) as Record<string, unknown> | null;
  } catch {
    return "exchange";
  }
  if (!body || typeof body !== "object") return "exchange";
  const refreshToken = body.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) return "no_refresh";
  return { refreshToken, account: (p === "google" && emailFromIdToken(body.id_token)) || SPEC[p].fallbackAccount };
}

/** The only log line this flow writes. Never a token, code, secret or upstream text. */
export const logStep = (p: Provider, step: string, ok: boolean) => console.info(`${p} step=${step} ok=${ok}`);
