import { afterEach, describe, expect, test } from "vitest";
import { driveClient, DRIVE_QUERY } from "../src/drive.js";
import { dropboxClient } from "../src/dropbox.js";
import { AuthRefused } from "../src/http.js";
import { fakeServer, form, json, testHttp } from "./fakes.js";

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers) await c();
  closers = [];
});
const serve = async (routes: Parameters<typeof fakeServer>[0]) => {
  const s = await fakeServer(routes);
  closers.push(s.close);
  return s;
};
const APP = { clientId: "app-id", clientSecret: "app-secret" };
const ok = (token: string) => (_: unknown, res: Parameters<typeof json>[0]) => json(res, 200, { access_token: token, expires_in: 3599 });

describe("Google Drive client", () => {
  test("refreshes the access token, then lists 'Rhythm Lab Radio' Docs page by page", async () => {
    const s = await serve({
      "POST /token": ok("g-access"),
      "GET /drive/v3/files": (req, res) =>
        req.query.get("pageToken") === "p2"
          ? json(res, 200, { files: [{ id: "d3", name: "Rhythm Lab Radio 1-9-26" }] })
          : json(res, 200, { nextPageToken: "p2", files: [{ id: "d1", name: "Rhythm Lab Radio 1-2-26" }, { id: "d2", name: "Rhythm Lab Radio 1-2-26 prep" }] }),
    });
    const drive = driveClient(testHttp(), APP, "g-refresh", { tokenUrl: `${s.base}/token`, api: `${s.base}/drive/v3` });
    expect(await drive.listDocs()).toEqual([
      { id: "d1", name: "Rhythm Lab Radio 1-2-26" }, { id: "d2", name: "Rhythm Lab Radio 1-2-26 prep" }, { id: "d3", name: "Rhythm Lab Radio 1-9-26" },
    ]);
    expect(form(s.calls("POST /token")[0]!)).toEqual({ grant_type: "refresh_token", refresh_token: "g-refresh", client_id: "app-id", client_secret: "app-secret" });
    expect(s.calls("POST /token")).toHaveLength(1);
    const [first] = s.calls("GET /drive/v3/files");
    expect(first!.query.get("q")).toBe("name contains 'Rhythm Lab Radio' and mimeType = 'application/vnd.google-apps.document' and trashed = false");
    expect(DRIVE_QUERY).toBe(first!.query.get("q"));
    expect(first!.headers.authorization).toBe("Bearer g-access");
  });

  test("exports a Doc as plain text (BOM dropped)", async () => {
    const s = await serve({
      "POST /token": ok("g-access"),
      "GET /drive/v3/files/d1/export": (req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(req.query.get("mimeType") === "text/plain" ? "﻿HOUR 1\r\nA - \"B\"" : "wrong");
      },
    });
    const drive = driveClient(testHttp(), APP, "g-refresh", { tokenUrl: `${s.base}/token`, api: `${s.base}/drive/v3` });
    expect(await drive.exportText("d1")).toBe("HOUR 1\r\nA - \"B\"");
  });

  test("invalid_grant (400) or invalid_client (401) on refresh is AuthRefused; a 500 is not", async () => {
    for (const [status, err] of [[400, "invalid_grant"], [401, "invalid_client"]] as const) {
      const s = await serve({ "POST /token": (_, res) => json(res, status, { error: err }) });
      await expect(driveClient(testHttp(), APP, "r", { tokenUrl: `${s.base}/token`, api: `${s.base}/drive/v3` }).listDocs()).rejects.toBeInstanceOf(AuthRefused);
    }
    const s = await serve({ "POST /token": (_, res) => json(res, 500, {}) });
    const e = await driveClient(testHttp(), APP, "r", { tokenUrl: `${s.base}/token`, api: `${s.base}/drive/v3` }).listDocs().catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(AuthRefused);
    expect(String(e)).not.toContain("r\"");
  });
});

describe("Dropbox client", () => {
  const routes = (meta: Record<string, unknown>) => ({
    "POST /oauth2/token": ok("dbx-access"),
    "POST /2/files/list_folder": (_: unknown, res: Parameters<typeof json>[0]) =>
      json(res, 200, { entries: [{ ".tag": "file", id: "id:p1", name: "Rhythm Lab Radio 1-2-26.paper" }, { ".tag": "folder", id: "id:f", name: "Notes" }], cursor: "c1", has_more: true }),
    "POST /2/files/list_folder/continue": (_: unknown, res: Parameters<typeof json>[0]) =>
      json(res, 200, { entries: [{ ".tag": "file", id: "id:p2", name: "Rhythm Lab Radio 1–09-26.paper" }], cursor: "c2", has_more: false }),
    "POST /2/files/get_metadata": (_: unknown, res: Parameters<typeof json>[0]) => json(res, 200, { ".tag": "file", id: "id:p1", name: "x.paper", ...meta }),
    "POST /2/files/export": (_: unknown, res: Parameters<typeof json>[0]) => { res.writeHead(200, { "dropbox-api-result": "{}" }); res.end("# Hour 1\n## 1. A – \"B\""); },
  });
  const client = (base: string) => dropboxClient(testHttp(), APP, "dbx-refresh", { tokenUrl: `${base}/oauth2/token`, api: `${base}/2`, content: `${base}/2` });

  test("refreshes, lists the whole Dropbox recursively with the cursor, files only", async () => {
    const s = await serve(routes({}));
    expect(await client(s.base).listFiles()).toEqual([{ id: "id:p1", name: "Rhythm Lab Radio 1-2-26.paper" }, { id: "id:p2", name: "Rhythm Lab Radio 1–09-26.paper" }]);
    expect(form(s.calls("POST /oauth2/token")[0]!)).toEqual({ grant_type: "refresh_token", refresh_token: "dbx-refresh", client_id: "app-id", client_secret: "app-secret" });
    expect(JSON.parse(s.calls("POST /2/files/list_folder")[0]!.body)).toEqual({ path: "", recursive: true, limit: 2000, include_non_downloadable_files: true });
    expect(JSON.parse(s.calls("POST /2/files/list_folder/continue")[0]!.body)).toEqual({ cursor: "c1" });
    expect(s.calls("POST /2/files/list_folder")[0]!.headers.authorization).toBe("Bearer dbx-access");
  });

  test("lists only the configured folder (recursively) when one is set", async () => {
    const s = await serve(routes({}));
    await dropboxClient(testHttp(), APP, "dbx-refresh", { tokenUrl: `${s.base}/oauth2/token`, api: `${s.base}/2`, content: `${s.base}/2`, folder: "/Paper Docs" }).listFiles();
    expect(JSON.parse(s.calls("POST /2/files/list_folder")[0]!.body)).toEqual({ path: "/Paper Docs", recursive: true, limit: 2000, include_non_downloadable_files: true });
  });

  test("reads export_options from get_metadata and exports markdown only when offered (never assumed)", async () => {
    const s = await serve(routes({ export_info: { export_as: "html", export_options: ["html", "markdown"] } }));
    expect(await client(s.base).exportText("id:p1")).toEqual({ kind: "ok", text: "# Hour 1\n## 1. A – \"B\"" });
    expect(JSON.parse(s.calls("POST /2/files/get_metadata")[0]!.body)).toEqual({ path: "id:p1" });
    const exp = s.calls("POST /2/files/export")[0]!;
    expect(JSON.parse(String(exp.headers["dropbox-api-arg"]))).toEqual({ path: "id:p1", export_format: "markdown" });
    expect(exp.body).toBe("");
  });

  test("no text format offered, not exportable, or a 409 export error is unreadable (a question), not a source failure", async () => {
    for (const meta of [{ export_info: { export_as: "html", export_options: ["html"] } }, {}]) {
      const s = await serve(routes(meta));
      expect(await client(s.base).exportText("id:p1")).toEqual({ kind: "unreadable" });
      expect(s.calls("POST /2/files/export")).toHaveLength(0);
    }
    const s = await serve({ ...routes({ export_info: { export_options: ["markdown"] } }), "POST /2/files/export": (_, res) => json(res, 409, { error_summary: "non_exportable/" }) });
    expect(await client(s.base).exportText("id:p1")).toEqual({ kind: "unreadable" });
  });

  test("a refused refresh token is AuthRefused", async () => {
    const s = await serve({ "POST /oauth2/token": (_, res) => json(res, 400, { error: "invalid_grant" }) });
    await expect(client(s.base).listFiles()).rejects.toBeInstanceOf(AuthRefused);
  });
});
