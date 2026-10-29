// Shared plumbing for the three provider clients (box.ts, drive.ts, dropbox.ts). No provider URL lives here: each client
// module names its own hosts, so the allow-list is one file per provider (CLAUDE.md conventions).

export type Fetch = typeof fetch;
export interface Http { fetch: Fetch; sleep: (ms: number) => Promise<void> }
export const realHttp: Http = { fetch: (input, init) => fetch(input, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** Every API call gives up after this; downloads and exports set their own. */
export const API_TIMEOUT_MS = 30_000;
/** A Retry-After longer than this is cut short; the next scan tries again anyway. */
const MAX_WAIT_MS = 60_000;
const RATE_LIMIT_RETRIES = 3;

/** The provider refused the credential itself (400/401 on the token call): the person must reconnect (R13). */
export class AuthRefused extends Error {
  /** The provider's OAuth error code (invalid_grant, invalid_client…) when it is a plain code, else "refused". */
  constructor(readonly code = "refused") { super(code); }
}

/** A short code only (Hard Rule 8): never a URL, a token or a provider's free text. */
export class HttpError extends Error {
  constructor(readonly status: number, code = `http_${status}`) { super(code); }
}

const waitFor = (header: string | null, attempt: number) => {
  const sec = Number(header);
  return Math.min(header !== null && Number.isFinite(sec) && sec >= 0 ? sec * 1000 : 2 ** attempt * 1000, MAX_WAIT_MS);
};

/** One request with a timeout. A 429 waits Retry-After (or backs off 1, 2, 4 s) and tries again, at most 3 times. */
export async function call(http: Http, url: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await http.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return res;
    await res.body?.cancel();
    await http.sleep(waitFor(res.headers.get("retry-after"), attempt));
  }
}

/** The body as text, refused past `max` bytes (Drive exports cap at 10 MB; a show's notes are a few KB). */
export async function readText(res: Response, max: number): Promise<string> {
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new HttpError(res.status, "too_large");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > max) throw new HttpError(res.status, "too_large");
  return new TextDecoder().decode(buf).replace(/^﻿/, "");
}

/** A JSON object body, or an error code. Never echoes the body. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status);
  }
  try {
    const j = JSON.parse(await readText(res, 8 * 1024 ** 2)) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new HttpError(res.status, "bad_json");
}

/**
 * An OAuth token call (form POST). 400/401 is the provider refusing the credential (invalid_grant, invalid_client):
 * AuthRefused. Anything else that is not a token is transient (HttpError): the source is skipped this scan only.
 */
export async function tokenCall(http: Http, url: string, form: Record<string, string>): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await call(http, url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  if (res.status === 400 || res.status === 401) {
    const err = await res.json().then((j) => (j as { error?: unknown } | null)?.error, () => undefined);
    throw new AuthRefused(typeof err === "string" && /^[a-z_]{1,40}$/.test(err) ? err : "refused");
  }
  const j = await readJson(res);
  if (typeof j.access_token !== "string" || !j.access_token) throw new HttpError(res.status, "no_access_token");
  return { accessToken: j.access_token, expiresIn: typeof j.expires_in === "number" ? j.expires_in : 3600 };
}
