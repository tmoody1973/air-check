import type { AppCreds } from "./config.js";
import { call, HttpError, readJson, readText, tokenCall, type Http } from "./http.js";
import type { DocRef } from "./drive.js";

// The only module that talks to Dropbox (Hard Rule 2). Read-only scopes: files.metadata.read + files.content.read. New
// Paper docs are `.paper` files: list_folder (recursive) + export (research §3). Never writes to Paper (Hard Rule 12).
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_API = "https://api.dropboxapi.com/2";
export const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";
const MAX_EXPORT_BYTES = 1024 ** 2;
const EXPORT_TIMEOUT_MS = 60_000;
// research §3 (UNVERIFIED which formats .paper offers): read export_options, prefer markdown, else a plain-text one.
// ponytail: an html-only doc is "unreadable" (a question for Tarik); add an html reader if the real export needs one.
const TEXT_FORMATS = [/^markdown$/i, /^(?:plain_?text|text|txt)$/i];

export type PaperExport = { kind: "ok"; text: string } | { kind: "unreadable" };
export interface DropboxClient { listFiles(): Promise<DocRef[]>; exportText(id: string): Promise<PaperExport> }
export interface DropboxOptions { tokenUrl?: string; api?: string; content?: string; folder?: string }

export function dropboxClient(http: Http, app: AppCreds, refreshToken: string, opts: DropboxOptions = {}): DropboxClient {
  const api = opts.api ?? DROPBOX_API;
  let access: Promise<string> | null = null; // one refresh per client; a client lives for one scan
  const auth = async () => {
    access ??= tokenCall(http, opts.tokenUrl ?? DROPBOX_TOKEN_URL, {
      grant_type: "refresh_token", refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret,
    }).then((t) => t.accessToken);
    return `Bearer ${await access}`;
  };
  const rpc = async (path: string, body: unknown) =>
    call(http, `${api}${path}`, { method: "POST", headers: { authorization: await auth(), "content-type": "application/json" }, body: JSON.stringify(body) });

  return {
    async listFiles() {
      const files: DocRef[] = [];
      let j = await readJson(await rpc("/files/list_folder", { path: opts.folder ?? "", recursive: true, limit: 2000, include_non_downloadable_files: true }));
      for (;;) {
        for (const e of Array.isArray(j.entries) ? (j.entries as Record<string, unknown>[]) : [])
          if (e[".tag"] === "file" && typeof e.id === "string" && typeof e.name === "string") files.push({ id: e.id, name: e.name });
        if (j.has_more !== true || typeof j.cursor !== "string") return files;
        j = await readJson(await rpc("/files/list_folder/continue", { cursor: j.cursor }));
      }
    },
    async exportText(id) {
      const meta = await rpc("/files/get_metadata", { path: id });
      if (meta.status === 409) {
        await meta.body?.cancel();
        return { kind: "unreadable" };
      }
      const info = (await readJson(meta)).export_info as { export_options?: unknown } | undefined;
      const options = Array.isArray(info?.export_options) ? info.export_options.filter((o): o is string => typeof o === "string") : [];
      const format = TEXT_FORMATS.map((re) => options.find((o) => re.test(o))).find(Boolean);
      if (!format) return { kind: "unreadable" };
      // Dropbox-API-Arg is a header: JSON with non-ASCII escaped (ids are ASCII; escape anyway).
      const arg = JSON.stringify({ path: id, export_format: format }).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      const res = await call(http, `${opts.content ?? DROPBOX_CONTENT}/files/export`, { method: "POST", headers: { authorization: await auth(), "dropbox-api-arg": arg } }, EXPORT_TIMEOUT_MS);
      if (res.status === 409) {
        await res.body?.cancel();
        return { kind: "unreadable" };
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new HttpError(res.status);
      }
      return { kind: "ok", text: await readText(res, MAX_EXPORT_BYTES) };
    },
  };
}
