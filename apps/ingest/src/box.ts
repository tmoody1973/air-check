import { createWriteStream } from "node:fs";
import { chmod, rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BoxCreds } from "./config.js";
import { AuthRefused, call, HttpError, readJson, tokenCall, type Http } from "./http.js";

// The only module that talks to Box (Hard Rule 2: the credentials live in this process's env, nowhere else). Server app,
// Client Credentials Grant, enterprise subject = the app's Service Account, read-only scope (research §1).
export const BOX_API = "https://api.box.com";
/** Never a file larger than this (a show hour is about 600 MB). */
export const MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3;
/** About 600 MB has to come down; Box's own limits are generous. */
export const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
/** Box tokens live 60 minutes; renew before then. */
const TOKEN_TTL_MS = 55 * 60_000;
const PAGE = 1000;

/** Box answers a download with a 302 to a short-lived dl.boxcloud.com URL (research §1). Nothing else is followed. */
export const isBoxDownloadHost = (u: URL) => u.protocol === "https:" && (u.hostname === "boxcloud.com" || u.hostname.endsWith(".boxcloud.com"));

export interface BoxItem { type: string; id: string; name: string; size: number }
export interface BoxClient {
  items(folderId: string): Promise<BoxItem[]>;
  /** Streams one file to `dest` (via `dest.part`, renamed when whole). Returns the byte count. */
  download(fileId: string, dest: string, expectedSize: number): Promise<number>;
}
export interface BoxOptions { api?: string; isDownloadHost?: (u: URL) => boolean; now?: () => number }

const id = (s: string) => {
  if (!/^\d+$/.test(s)) throw new HttpError(0, "bad_id");
  return s;
};

/** Counts bytes on their way to disk and fails the stream past `max`. */
const limit = (max: number) => {
  let n = 0;
  return Object.assign(new Transform({
    transform(chunk: Buffer, _enc, done) {
      n += chunk.length;
      done(n > max ? new HttpError(0, "too_large") : null, chunk);
    },
  }), { bytes: () => n });
};

export function boxClient(http: Http, creds: Pick<BoxCreds, "clientId" | "clientSecret" | "enterpriseId">, opts: BoxOptions = {}): BoxClient {
  const api = opts.api ?? BOX_API;
  const now = opts.now ?? Date.now;
  const isDownloadHost = opts.isDownloadHost ?? isBoxDownloadHost;
  let cached: { token: string; until: number } | null = null;

  const token = async () => {
    if (cached && now() < cached.until) return cached.token;
    const t = await tokenCall(http, `${api}/oauth2/token`, {
      grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.clientSecret,
      box_subject_type: "enterprise", box_subject_id: creds.enterpriseId,
    });
    cached = { token: t.accessToken, until: now() + Math.min(TOKEN_TTL_MS, (t.expiresIn - 300) * 1000) };
    return cached.token;
  };

  /** One authorised call; a 401 means the cached token expired early, so it is replaced once. */
  const authed = async (url: string, init: RequestInit = {}, timeoutMs?: number) => {
    for (let attempt = 0; ; attempt++) {
      const res = await call(http, url, { ...init, headers: { ...init.headers as Record<string, string>, authorization: `Bearer ${await token()}` } }, timeoutMs);
      if (res.status !== 401 || attempt > 0) return res;
      await res.body?.cancel();
      cached = null;
    }
  };

  return {
    async items(folderId) {
      const all: BoxItem[] = [];
      for (let offset = 0; ; ) {
        const q = new URLSearchParams({ fields: "id,type,name,size", limit: String(PAGE), offset: String(offset) });
        const j = await readJson(await authed(`${api}/2.0/folders/${id(folderId)}/items?${q}`));
        const entries = Array.isArray(j.entries) ? (j.entries as Record<string, unknown>[]) : [];
        for (const e of entries)
          if (typeof e.id === "string" && typeof e.name === "string" && typeof e.type === "string")
            all.push({ type: e.type, id: e.id, name: e.name, size: typeof e.size === "number" ? e.size : 0 });
        offset += entries.length;
        if (!entries.length || offset >= Number(j.total_count ?? 0)) return all;
      }
    },

    async download(fileId, dest, expectedSize) {
      if (expectedSize > MAX_DOWNLOAD_BYTES) throw new HttpError(0, "too_large");
      const part = `${dest}.part`;
      try {
        let res = await authed(`${api}/2.0/files/${id(fileId)}/content`, { redirect: "manual" }, DOWNLOAD_TIMEOUT_MS);
        if (res.status >= 300 && res.status < 400) {
          await res.body?.cancel();
          const to = new URL(res.headers.get("location") ?? "", api);
          if (!isDownloadHost(to)) throw new HttpError(res.status, "bad_redirect");
          // A different host: the Box token is not sent there (the signed URL is the credential).
          res = await call(http, to.href, { redirect: "error" }, DOWNLOAD_TIMEOUT_MS);
        }
        if (res.status !== 200 || !res.body) {
          await res.body?.cancel();
          throw new HttpError(res.status, res.status === 202 ? "not_ready" : `http_${res.status}`);
        }
        if (Number(res.headers.get("content-length") ?? 0) > MAX_DOWNLOAD_BYTES) {
          await res.body.cancel();
          throw new HttpError(200, "too_large");
        }
        const counter = limit(MAX_DOWNLOAD_BYTES);
        await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), counter, createWriteStream(part, { mode: 0o644 }));
        if (counter.bytes() !== expectedSize) throw new HttpError(200, "size_mismatch");
        await chmod(part, 0o644); // umask may have narrowed it; the media service and console read these
        await rename(part, dest);
        return counter.bytes();
      } catch (e) {
        await rm(part, { force: true });
        throw e instanceof AuthRefused || e instanceof HttpError ? e : new HttpError(0, "download_failed");
      }
    },
  };
}
