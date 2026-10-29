import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { boxClient, MAX_DOWNLOAD_BYTES } from "../src/box.js";
import { AuthRefused } from "../src/http.js";
import { fakeServer, form, json, testHttp } from "./fakes.js";

const CREDS = { clientId: "cid", clientSecret: "csecret", enterpriseId: "777", folderId: "123" };
const token = (n = 1) => (_: unknown, res: Parameters<typeof json>[0]) => json(res, 200, { access_token: `box-token-${n}`, expires_in: 3600, token_type: "bearer" });
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

describe("Box client (Client Credentials Grant)", () => {
  test("gets an enterprise token with the client credentials and reuses it", async () => {
    const s = await serve({
      "POST /oauth2/token": token(),
      "GET /2.0/folders/123/items": (_, res) => json(res, 200, { total_count: 0, entries: [] }),
    });
    const box = boxClient(testHttp(), CREDS, { api: s.base });
    await box.items("123");
    await box.items("123");
    expect(s.calls("POST /oauth2/token")).toHaveLength(1);
    expect(form(s.calls("POST /oauth2/token")[0]!)).toEqual({
      grant_type: "client_credentials", client_id: "cid", client_secret: "csecret", box_subject_type: "enterprise", box_subject_id: "777",
    });
    expect(s.calls("GET /2.0/folders/123/items")[0]!.headers.authorization).toBe("Bearer box-token-1");
  });

  test("a new token after 55 minutes, even when Box says 60", async () => {
    let now = 0;
    const s = await serve({
      "POST /oauth2/token": [token(1), token(2)],
      "GET /2.0/folders/123/items": (_, res) => json(res, 200, { total_count: 0, entries: [] }),
    });
    const box = boxClient(testHttp(), CREDS, { api: s.base, now: () => now });
    await box.items("123");
    now = 54 * 60_000;
    await box.items("123");
    now = 56 * 60_000;
    await box.items("123");
    expect(s.calls("POST /oauth2/token")).toHaveLength(2);
    expect(s.calls("GET /2.0/folders/123/items")[2]!.headers.authorization).toBe("Bearer box-token-2");
  });

  test("lists every page by offset, with only the fields it needs", async () => {
    const entries = [1, 2, 3, 4, 5].map((i) => ({ type: i < 3 ? "folder" : "file", id: String(i), name: `n${i}`, size: i * 10 }));
    const s = await serve({
      "POST /oauth2/token": token(),
      "GET /2.0/folders/123/items": (req, res) => {
        const off = Number(req.query.get("offset"));
        json(res, 200, { total_count: 5, offset: off, entries: entries.slice(off, off + 2) });
      },
    });
    const items = await boxClient(testHttp(), CREDS, { api: s.base }).items("123");
    expect(items).toEqual(entries);
    const q = s.calls("GET /2.0/folders/123/items").map((c) => [c.query.get("offset"), c.query.get("limit"), c.query.get("fields")]);
    expect(q).toEqual([["0", "1000", "id,type,name,size"], ["2", "1000", "id,type,name,size"], ["4", "1000", "id,type,name,size"]]);
  });

  test("a refused client credential is AuthRefused; a 429 waits Retry-After and tries again", async () => {
    const refused = await serve({ "POST /oauth2/token": (_, res) => json(res, 400, { error: "invalid_client" }) });
    await expect(boxClient(testHttp(), CREDS, { api: refused.base }).items("123")).rejects.toBeInstanceOf(AuthRefused);

    const http = testHttp();
    const s = await serve({
      "POST /oauth2/token": token(),
      "GET /2.0/folders/123/items": [(_, res) => json(res, 429, {}, { "retry-after": "7" }), (_, res) => json(res, 200, { total_count: 0, entries: [] })],
    });
    expect(await boxClient(http, CREDS, { api: s.base }).items("123")).toEqual([]);
    expect(http.slept).toEqual([7000]);
  });

  test("an expired token (401 on a call) is replaced once", async () => {
    const s = await serve({
      "POST /oauth2/token": [token(1), token(2)],
      "GET /2.0/folders/123/items": [(_, res) => json(res, 401, {}), (_, res) => json(res, 200, { total_count: 0, entries: [] })],
    });
    expect(await boxClient(testHttp(), CREDS, { api: s.base }).items("123")).toEqual([]);
    expect(s.calls("GET /2.0/folders/123/items").map((c) => c.headers.authorization)).toEqual(["Bearer box-token-1", "Bearer box-token-2"]);
  });
});

describe("Box download", () => {
  const BYTES = Buffer.from("RIFF....WAVEfake audio bytes");

  test("follows the 302 to the download host without the Authorization header, streams to .part, then renames (0644)", async () => {
    const dl = await serve({ "GET /d/abc": (_, res) => { res.writeHead(200, { "content-length": String(BYTES.length) }); res.end(BYTES); } });
    const api = await serve({
      "POST /oauth2/token": token(),
      "GET /2.0/files/42/content": (_, res) => { res.writeHead(302, { location: `${dl.base}/d/abc` }); res.end(); },
    });
    const dir = await mkdtemp(join(tmpdir(), "box-"));
    const dest = join(dir, "1-9125.wav");
    const box = boxClient(testHttp(), CREDS, { api: api.base, isDownloadHost: (u) => u.origin === dl.base });
    expect(await box.download("42", dest, BYTES.length)).toBe(BYTES.length);
    expect(await readFile(dest)).toEqual(BYTES);
    expect((await stat(dest)).mode & 0o777).toBe(0o644);
    expect(await readdir(dir)).toEqual(["1-9125.wav"]);
    expect(api.calls("GET /2.0/files/42/content")[0]!.headers.authorization).toBe("Bearer box-token-1");
    expect(dl.calls("GET /d/abc")[0]!.headers.authorization).toBeUndefined();
  });

  test("refuses a redirect to a host that is not Box's download host, a file over 2 GB, or the wrong size; leaves no .part", async () => {
    const dl = await serve({
      "GET /d/abc": (_, res) => { res.writeHead(200); res.end(BYTES); },
      "GET /d/huge": (_, res) => { res.writeHead(200, { "content-length": String(MAX_DOWNLOAD_BYTES + 1) }); res.end(); },
    });
    const api = await serve({
      "POST /oauth2/token": token(),
      "GET /2.0/files/42/content": (_, res) => { res.writeHead(302, { location: `${dl.base}/d/abc` }); res.end(); },
      "GET /2.0/files/43/content": (_, res) => { res.writeHead(302, { location: `${dl.base}/d/huge` }); res.end(); },
    });
    const dir = await mkdtemp(join(tmpdir(), "box-"));
    const strict = boxClient(testHttp(), CREDS, { api: api.base });
    await expect(strict.download("42", join(dir, "a.wav"), BYTES.length)).rejects.toThrow("bad_redirect");
    expect(dl.calls("GET /d/abc")).toHaveLength(0);

    const box = boxClient(testHttp(), CREDS, { api: api.base, isDownloadHost: (u) => u.origin === dl.base });
    await expect(box.download("42", join(dir, "b.wav"), MAX_DOWNLOAD_BYTES + 1)).rejects.toThrow("too_large");
    await expect(box.download("43", join(dir, "c.wav"), 10)).rejects.toThrow("too_large");
    await expect(box.download("42", join(dir, "d.wav"), BYTES.length + 1)).rejects.toThrow("size_mismatch");
    expect(await readdir(dir)).toEqual([]);
  });

  test("the default download host check accepts only https on boxcloud.com", async () => {
    const { isBoxDownloadHost } = await import("../src/box.js");
    expect(isBoxDownloadHost(new URL("https://dl.boxcloud.com/d/1/x"))).toBe(true);
    expect(isBoxDownloadHost(new URL("https://public.boxcloud.com/d/1/x"))).toBe(true);
    expect(isBoxDownloadHost(new URL("http://dl.boxcloud.com/d/1/x"))).toBe(false);
    expect(isBoxDownloadHost(new URL("https://dl.boxcloud.com.evil.example/x"))).toBe(false);
    expect(isBoxDownloadHost(new URL("https://evilboxcloud.com/x"))).toBe(false);
  });
});
