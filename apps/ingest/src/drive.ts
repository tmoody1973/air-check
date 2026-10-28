import type { AppCreds } from "./config.js";
import { call, HttpError, readJson, readText, tokenCall, type Http } from "./http.js";

// The only module that talks to Google (Hard Rule 2). Read-only: drive.readonly is the narrowest scope that can find a
// Doc by name and export it (research §2). Doc text is untrusted data: it is parsed, never followed (Hard Rule 5).
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DRIVE_API = "https://www.googleapis.com/drive/v3";
/** R3. `name contains` may match on word prefixes; the caller checks the date in the title. */
export const DRIVE_QUERY = "name contains 'Rhythm Lab Radio' and mimeType = 'application/vnd.google-apps.document' and trashed = false";
/** A tracklist is a few KB; Google caps exports at 10 MB. */
const MAX_EXPORT_BYTES = 1024 ** 2;
const EXPORT_TIMEOUT_MS = 60_000;

export interface DocRef { id: string; name: string }
export interface DriveClient { listDocs(): Promise<DocRef[]>; exportText(id: string): Promise<string> }
export interface DriveOptions { tokenUrl?: string; api?: string }

export function driveClient(http: Http, app: AppCreds, refreshToken: string, opts: DriveOptions = {}): DriveClient {
  const api = opts.api ?? DRIVE_API;
  let access: Promise<string> | null = null; // one refresh per client; a client lives for one scan
  const auth = async () => {
    access ??= tokenCall(http, opts.tokenUrl ?? GOOGLE_TOKEN_URL, {
      grant_type: "refresh_token", refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret,
    }).then((t) => t.accessToken);
    return { authorization: `Bearer ${await access}` };
  };
  return {
    async listDocs() {
      const docs: DocRef[] = [];
      let pageToken = "";
      do {
        const q = new URLSearchParams({ q: DRIVE_QUERY, fields: "nextPageToken,files(id,name)", pageSize: "1000", ...(pageToken && { pageToken }) });
        const j = await readJson(await call(http, `${api}/files?${q}`, { headers: await auth() }));
        for (const f of Array.isArray(j.files) ? (j.files as Record<string, unknown>[]) : [])
          if (typeof f.id === "string" && typeof f.name === "string") docs.push({ id: f.id, name: f.name });
        pageToken = typeof j.nextPageToken === "string" ? j.nextPageToken : "";
      } while (pageToken);
      return docs;
    },
    async exportText(id) {
      const res = await call(http, `${api}/files/${encodeURIComponent(id)}/export?mimeType=text/plain`, { headers: await auth() }, EXPORT_TIMEOUT_MS);
      if (!res.ok) {
        await res.body?.cancel();
        throw new HttpError(res.status);
      }
      return readText(res, MAX_EXPORT_BYTES);
    },
  };
}
