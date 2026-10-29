import { showDateFromTitle } from "@aircheck/core";
import { appOrigin } from "./app-origin";
import { writeTokenFile as writeAnyTokenFile } from "./oauth";

export { newState, readCookie, removeTokenFile, sameOrigin, statesMatch } from "./oauth";

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

export const stateCookie = (value: string) => `${STATE_COOKIE}=${value}; ${COOKIE_ATTRS}; Max-Age=600`;

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

/** Atomic, mode 640 (see oauth.ts). */
export const writeTokenFile = (path: string, data: TokenFile) => writeAnyTokenFile(path, data);

/** The only log line this flow writes. Never the token, code, secret or upstream text. */
export const logStep = (step: string, ok: boolean) => console.info(`mixcloud step=${step} ok=${ok}`);

// Add a 2025 show: which dates already have a show on Tarik's Mixcloud, read from the PUBLIC cloudcasts list (no
// token, never a write). Names are untrusted text: returned as data, shown as plain text, never logged.
const POSTED_FIRST = "https://api.mixcloud.com/rhythmlab/cloudcasts/?limit=100";
const POSTED_PAGES = 10;
const POSTED_TIMEOUT_MS = 8_000;
const MAX_NAME = 300;
export type Posted = { date: string; name: string };

/** `year`'s shows already on Mixcloud, dated from their names, oldest first; null when Mixcloud can't be read. */
export async function postedShows(year: string): Promise<Posted[] | null> {
  const out: Posted[] = [];
  let url: string | undefined = POSTED_FIRST;
  try {
    for (let i = 0; i < POSTED_PAGES && url; i++) {
      const res = await fetch(url, { signal: AbortSignal.timeout(POSTED_TIMEOUT_MS), cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: unknown; paging?: { next?: unknown } } | null;
      if (!Array.isArray(body?.data)) return null;
      let older = false;
      for (const c of body.data as { name?: unknown; created_time?: unknown }[]) {
        if (typeof c?.name !== "string") continue;
        const d = showDateFromTitle(c.name);
        if (d.ok && d.date.startsWith(`${year}-`)) out.push({ date: d.date, name: c.name.slice(0, MAX_NAME) });
        // Newest uploads first: one from before the year means every later page is older too.
        if (typeof c.created_time === "string" && c.created_time < year) older = true;
      }
      const next = body.paging?.next;
      // Only Mixcloud's own API is followed, never a link the response points elsewhere.
      url = !older && typeof next === "string" && next.startsWith("https://api.mixcloud.com/") ? next : undefined;
    }
  } catch {
    return null;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
