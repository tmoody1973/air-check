import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import { AUDIO_MISSING } from "@aircheck/core";

/** Hard Rule 1: the only file allowed to name Mixcloud's upload endpoint (packages/core/src/boundaries.ts pins it). */
export const MIXCLOUD_UPLOAD_URL = "https://api.mixcloud.com/upload/";
/** A description edit needs no audio; a minute is plenty. */
export const EDIT_TIMEOUT_MS = 60_000;
const SHOW_BASE = "https://www.mixcloud.com";
/** About 140 MB has to cross the VM's uplink. */
export const UPLOAD_TIMEOUT_MS = 30 * 60_000;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
/** A Retry-After longer than this is cut short; a second rate limit then fails the package rather than wait a day. */
const MAX_RETRY_AFTER_SEC = 15 * 60;

export type TokenRead = { kind: "missing" } | { kind: "invalid" } | { kind: "ok"; accessToken: string; account?: string; connectedAt?: number };

/**
 * The console writes `{access_token, account, connectedAt}` (Task 4) without an fsync, so an empty or half-written
 * file is possible after a crash: that is `invalid`, never a guess.
 */
export async function readTokenFile(path: string): Promise<TokenRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "invalid" };
  }
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (typeof j.access_token !== "string" || !j.access_token) return { kind: "invalid" };
    return {
      kind: "ok", accessToken: j.access_token,
      ...(typeof j.account === "string" ? { account: j.account } : {}),
      ...(typeof j.connectedAt === "number" ? { connectedAt: j.connectedAt } : {}),
    };
  } catch {
    return { kind: "invalid" };
  }
}

const has = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
/** The image type by magic bytes (JPEG, PNG, WebP, GIF), or null. The Content-Type header is not trusted. */
export function imageType(b: Uint8Array): string | null {
  if (has(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (has(b, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (has(b, [0x52, 0x49, 0x46, 0x46]) && has(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (has(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  return null;
}

export type UploadOutcome =
  | { kind: "succeeded"; url: string }
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "invalid_token" }
  /** Refused, or never sent: nothing was posted. `code` is short and never Mixcloud's free text. */
  | { kind: "failed"; code: string }
  /** The body may have reached Mixcloud. Never retried (Review Focus 1). */
  | { kind: "unknown" };

export interface UploadInput {
  accessToken: string; fields: Record<string, string>; mp3Path: string; picture: { bytes: Uint8Array<ArrayBuffer>; type: string };
  unlisted?: boolean; uploadUrl?: string; timeoutMs?: number;
}

/** One multipart POST. The MP3 is a file-backed Blob, so fetch streams it from disk and never holds it in memory. */
export async function uploadShow(i: UploadInput): Promise<UploadOutcome> {
  const form = new FormData();
  for (const [k, v] of Object.entries(i.fields)) form.append(k, v);
  if (i.unlisted) form.append("unlisted", "1");
  form.append("picture", new Blob([i.picture.bytes], { type: i.picture.type }), `cover.${i.picture.type.slice("image/".length)}`);
  try {
    form.append("mp3", await openAsBlob(i.mp3Path, { type: "audio/mpeg" }), "show.mp3");
  } catch {
    return { kind: "failed", code: AUDIO_MISSING }; // nothing was sent yet; reopening rebuilds the MP3
  }
  const url = new URL(i.uploadUrl ?? MIXCLOUD_UPLOAD_URL);
  url.searchParams.set("access_token", i.accessToken); // R19: Mixcloud documents only the query form; never logged
  try {
    // A redirect would re-send the show somewhere else: never follow one.
    const res = await fetch(url, { method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(i.timeoutMs ?? UPLOAD_TIMEOUT_MS) });
    return classify(res.status, res.headers.get("retry-after"), await res.text());
  } catch {
    return { kind: "unknown" };
  }
}

function retryAfterSeconds(header: string | null): number {
  const n = Number(header);
  return header !== null && Number.isFinite(n) && n >= 0 ? Math.min(Math.max(Math.ceil(n), 1), MAX_RETRY_AFTER_SEC) : 60;
}

/** R23: what Mixcloud's answer proves. Only a 2xx with a show key is a success; only a 4xx proves a refusal. */
export function classify(status: number, retryAfter: string | null, text: string): UploadOutcome {
  let body: { result?: { success?: unknown; key?: unknown }; error?: { type?: unknown; message?: unknown } } | undefined;
  try {
    body = JSON.parse(text) ?? undefined;
  } catch {
    body = undefined;
  }
  if (status >= 200 && status < 300) {
    const key = body?.result?.success === true ? body.result.key : undefined;
    const show = typeof key === "string" ? SHOW_BASE + key : "";
    return show.startsWith(`${SHOW_BASE}/`) ? { kind: "succeeded", url: show } : { kind: "unknown" };
  }
  if (status < 400 || status >= 500) return { kind: "unknown" };
  const type = typeof body?.error?.type === "string" ? body.error.type : "";
  const message = typeof body?.error?.message === "string" ? body.error.message : "";
  if (status === 403 && (retryAfter !== null || type === "RateLimitException")) return { kind: "rate_limited", retryAfterSec: retryAfterSeconds(retryAfter) };
  if (type === "OAuthException" || /invalid access token/i.test(message)) return { kind: "invalid_token" };
  return { kind: "failed", code: /^\w{1,40}$/.test(type) ? type : `http_${status}` };
}

/** A show's own address on Mixcloud: exactly https://www.mixcloud.com/<user>/<slug>/, plain path characters only. */
const SHOW_URL = /^https:\/\/www\.mixcloud\.com\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,200})\/$/;

/**
 * Plan 5c Task 4 (Review Focus 3): the edit endpoint for a show, built only from the package's own receipt URL.
 * Anything that is not exactly a show address (other host, extra segments, dots, escapes, a query) is null, so no
 * request is ever sent. ponytail: slugs with non-ASCII (percent-escaped) characters are refused too; widen if one appears.
 */
export function showEditUrl(showUrl: string, base: string = MIXCLOUD_UPLOAD_URL): string | null {
  const m = SHOW_URL.exec(showUrl);
  return m ? `${base}${m[1]}/${m[2]}/edit/` : null;
}

export type EditOutcome = { kind: "pushed" } | { kind: "retry" } | { kind: "unconfirmed" } | { kind: "invalid_token" } | { kind: "failed"; code: string };

/**
 * One multipart POST with only `description`: Mixcloud changes name, picture and description only when posted, and
 * replaces tags, sections and hosts wholesale if any of them is posted, so nothing else is sent. An edit is idempotent,
 * so anything short of a clear answer (no answer, a timeout, a 5xx, a rate limit) is `retry`.
 */
export async function editDescription(i: { accessToken: string; editUrl: string; description: string; timeoutMs?: number }): Promise<EditOutcome> {
  const form = new FormData();
  form.append("description", i.description);
  const url = new URL(i.editUrl);
  url.searchParams.set("access_token", i.accessToken); // never logged
  try {
    const res = await fetch(url, { method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(i.timeoutMs ?? EDIT_TIMEOUT_MS) });
    return classifyEdit(res.status, res.headers.get("retry-after"), await res.text());
  } catch {
    return { kind: "retry" };
  }
}

/**
 * Only a 2xx with `success: true` is pushed. Any other 2xx is `unconfirmed`: Mixcloud took it but did not say it changed
 * (tried again, and named apart from a network failure). A refused key and other 4xx are final; the rest is `retry`.
 */
export function classifyEdit(status: number, retryAfter: string | null, text: string): EditOutcome {
  if (status >= 200 && status < 300) {
    let success: unknown;
    try {
      success = (JSON.parse(text) as { result?: { success?: unknown } } | null)?.result?.success;
    } catch { /* not JSON: no proof it changed */ }
    return success === true ? { kind: "pushed" } : { kind: "unconfirmed" };
  }
  if (status === 408 || status === 429) return { kind: "retry" };
  const o = classify(status, retryAfter, text);
  return o.kind === "invalid_token" || o.kind === "failed" ? o : { kind: "retry" };
}
