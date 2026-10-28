import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { appOrigin } from "./app-origin";

// The console's half of Connect Mixcloud (server only). The access token goes from Mixcloud's response straight
// into the token file that only the publisher reads: never into Convex, a log line or a URL we hand to a browser.

export const STATE_COOKIE = "mixcloud_oauth_state";
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/api/mixcloud";
export const CLEAR_STATE_COOKIE = `${STATE_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;

export type ErrorReason = "state" | "denied" | "exchange" | "profile" | "write" | "status" | "config";

export type MixcloudConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type TokenFile = { access_token: string; account: string; connectedAt: number };

const TIMEOUT_MS = 15_000;

/** Null when any setting is missing. The redirect URI is built here once; Mixcloud needs it identical in both calls. */
export function mixcloudConfig(): MixcloudConfig | null {
  const clientId = process.env.MIXCLOUD_CLIENT_ID;
  const clientSecret = process.env.MIXCLOUD_CLIENT_SECRET;
  const origin = appOrigin();
  if (!clientId || !clientSecret || !origin) return null;
  return { clientId, clientSecret, redirectUri: `${origin}/api/mixcloud/callback` };
}

export const tokenFilePath = () => process.env.MIXCLOUD_TOKEN_FILE || "/mixcloud/token.json";

/** `state` is standard OAuth 2; Mixcloud does not document echoing it, so the callback checks it only when it comes back. */
export const authorizeUrl = (cfg: MixcloudConfig, state: string) =>
  `https://www.mixcloud.com/oauth/authorize?${new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state })}`;

export const accessTokenUrl = (cfg: MixcloudConfig, code: string) =>
  `https://www.mixcloud.com/oauth/access_token?${new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, client_secret: cfg.clientSecret, code,
  })}`;

export const errorLocation = (reason: ErrorReason) => `/settings?mixcloud=error&reason=${reason}`;

export const newState = () => randomBytes(32).toString("base64url");
export const stateCookie = (value: string) => `${STATE_COOKIE}=${value}; ${COOKIE_ATTRS}; Max-Age=600`;

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Constant time for equal lengths; length itself is not secret (always 43 chars). */
export function statesMatch(expected: string | undefined, got: string | undefined): boolean {
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** CSRF guard for cookie-authenticated POSTs: the browser's Origin must be the console's own. */
export function sameOrigin(request: Request): boolean {
  const origin = appOrigin();
  return !!origin && request.headers.get("origin") === origin;
}

/** Mixcloud answers form-encoded (`access_token=…`); accept JSON too. Missing or empty → null. */
export function parseTokenResponse(body: string): string | null {
  const text = body.trim();
  let token: unknown;
  if (text.startsWith("{")) {
    try {
      token = (JSON.parse(text) as Record<string, unknown>).access_token;
    } catch {
      return null;
    }
  } else {
    token = new URLSearchParams(text).get("access_token");
  }
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Any failure (network, timeout, non-2xx, no token) is null; the caller reports a fixed reason code. */
export async function exchangeCode(cfg: MixcloudConfig, code: string): Promise<string | null> {
  try {
    const res = await fetch(accessTokenUrl(cfg, code), { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    return res.ok ? parseTokenResponse(await res.text()) : null;
  } catch {
    return null;
  }
}

export async function fetchAccount(accessToken: string): Promise<string | null> {
  try {
    const url = `https://api.mixcloud.com/me/?${new URLSearchParams({ access_token: accessToken })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const username = ((await res.json()) as Record<string, unknown> | null)?.username;
    return typeof username === "string" && username.length > 0 && username.length <= 200 ? username : null;
  } catch {
    return null;
  }
}

/** Temp file in the same folder, then rename, so the publisher never reads half a file. Mode set after write so umask can't change it. */
export async function writeTokenFile(path: string, data: TokenFile): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    await chmod(tmp, 0o640);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Deletes the token file; a missing file is already the goal. */
export const removeTokenFile = (path: string) => rm(path, { force: true });

/** The only log line this flow writes. Never the token, code, secret or upstream text. */
export const logStep = (step: string, ok: boolean) => console.info(`mixcloud step=${step} ok=${ok}`);
