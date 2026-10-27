import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { request, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/server.js";

const dir = mkdtempSync(join(tmpdir(), "bridge-tls-"));
const cert = join(dir, "tls.crt");
const key = join(dir, "tls.key");
const crateToken = "c".repeat(40);
const aircheckToken = "a".repeat(40);
const fakeCrate = fileURLToPath(new URL("./fixtures/fake-crate.mjs", import.meta.url));

let server: Server;
let port: number;

beforeAll(async () => {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", key, "-out", cert,
  ], { stdio: "ignore" });
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    tlsCert: cert,
    tlsKey: key,
    crate: { command: process.execPath, args: [fakeCrate], cwd: dir, timeoutMs: 2000 },
    crateMcpToken: crateToken,
    aircheckMcpToken: aircheckToken,
    convexSiteUrl: "https://127.0.0.1:1", // unreachable: these tests never submit
    agentSubmitToken: "s".repeat(40),
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function send(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method ?? "GET",
        ca: readFileSync(cert),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(opts.body === undefined ? undefined : JSON.stringify(opts.body));
  });
}

const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method, params });

describe("bridge HTTPS server", () => {
  it("GET /healthz is 200 ok with no auth", async () => {
    expect(await send("/healthz")).toEqual({ status: 200, body: "ok" });
  });

  it("unknown paths are 404", async () => {
    expect((await send("/other")).status).toBe(404);
  });

  it("/crate/mcp without a bearer is 401", async () => {
    expect((await send("/crate/mcp", { method: "POST", body: rpc("tools/list") })).status).toBe(401);
  });

  it("each endpoint refuses the other endpoint's token", async () => {
    expect((await send("/crate/mcp", { method: "POST", token: aircheckToken, body: rpc("tools/list") })).status).toBe(401);
    expect((await send("/aircheck/mcp", { method: "POST", token: crateToken, body: rpc("tools/list") })).status).toBe(401);
  });

  it("GET on an MCP path is 405", async () => {
    expect((await send("/crate/mcp", { token: crateToken })).status).toBe(405);
  });

  it("refuses a body over the NemoClaw cap", async () => {
    const big = rpc("tools/list", { pad: "x".repeat(140_000) });
    expect((await send("/aircheck/mcp", { method: "POST", token: aircheckToken, body: big })).status).toBe(413);
  });

  it("/crate/mcp lists only allowlisted tools", async () => {
    const r = await send("/crate/mcp", { method: "POST", token: crateToken, body: rpc("tools/list") });
    expect(r.status).toBe(200);
    const names = JSON.parse(r.body).result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["bandcamp_get_artist_page", "musicbrainz_echo", "musicbrainz_exit", "musicbrainz_sleep"]);
  });

  it("/crate/mcp forwards an allowed call and refuses a hidden one", async () => {
    const ok = await send("/crate/mcp", {
      method: "POST",
      token: crateToken,
      body: rpc("tools/call", { name: "musicbrainz_echo", arguments: { q: "x" } }),
    });
    expect(JSON.parse(ok.body).result.content[0].text).toContain('"q":"x"');
    const no = await send("/crate/mcp", {
      method: "POST",
      token: crateToken,
      body: rpc("tools/call", { name: "telegraph_post", arguments: {} }),
    });
    expect(JSON.parse(no.body).error.message).toMatch(/not available/);
    expect(existsSync(join(dir, "telegraph-called"))).toBe(false);
  });

  it("offers tools only: prompts/list is method-not-found", async () => {
    const r = await send("/crate/mcp", { method: "POST", token: crateToken, body: rpc("prompts/list") });
    expect(JSON.parse(r.body).error.code).toBe(-32601);
  });

  it("refuses a JSON-RPC batch with 400", async () => {
    const r = await send("/aircheck/mcp", { method: "POST", token: aircheckToken, body: [rpc("tools/list")] });
    expect(r.status).toBe(400);
  });

  it("/aircheck/mcp lists package_submit only", async () => {
    const r = await send("/aircheck/mcp", { method: "POST", token: aircheckToken, body: rpc("tools/list") });
    expect(JSON.parse(r.body).result.tools.map((t: { name: string }) => t.name)).toEqual(["package_submit"]);
  });
});
