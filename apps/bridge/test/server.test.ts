import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
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
const demoToken = "d".repeat(40);
const fakeCrate = fileURLToPath(new URL("./fixtures/fake-crate.mjs", import.meta.url));

let server: Server;
let port: number;
let bareServer: Server; // same config minus the demo pair
let barePort: number;
let convexStub: HttpServer;
const convexHits: { auth?: string; body: string; url?: string }[] = [];

beforeAll(async () => {
  convexStub = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      convexHits.push({ auth: req.headers.authorization, body, url: req.url });
      if (req.url === "/agent/research") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ saved: "H1.1", claims: 1, verify: 0, dropped: [] }));
      if (req.url === "/agent/packages/get") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ packageId: "pkg-stub", status: "awaiting_review" }));
      const revise = req.url === "/agent/packages/revise";
      res.writeHead(revise ? 200 : 201, { "content-type": "application/json" }).end(JSON.stringify({ packageId: "pkg-stub", ...(revise && { status: "awaiting_review" }) }));
    });
  });
  await new Promise<void>((r) => convexStub.listen(0, "127.0.0.1", r));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", key, "-out", cert,
  ], { stdio: "ignore" });
  const base = {
    host: "127.0.0.1",
    port: 0,
    tlsCert: cert,
    tlsKey: key,
    crate: { command: process.execPath, args: [fakeCrate], cwd: dir, timeoutMs: 2000 },
    crateMcpToken: crateToken,
    aircheckMcpToken: aircheckToken,
    convexSiteUrl: `http://127.0.0.1:${(convexStub.address() as AddressInfo).port}`, // local stub
    agentSubmitToken: "s".repeat(40),
  };
  server = await startServer({ ...base, demoMcpToken: demoToken, demoSubmitToken: "m".repeat(40) });
  port = (server.address() as AddressInfo).port;
  bareServer = await startServer(base);
  barePort = (bareServer.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => bareServer.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => convexStub.close(() => r()));
});

function send(path: string, opts: { method?: string; token?: string; body?: unknown; port?: number } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: opts.port ?? port,
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
    expect(names).toEqual(["bandcamp_search_bandcamp", "musicbrainz_echo", "musicbrainz_exit", "musicbrainz_sleep", "wikipedia_links"]);
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

  it("/aircheck/mcp lists package_submit, package_revise, package_get, episode_mark_rerun, radar_get, source_search and research_submit only", async () => {
    const r = await send("/aircheck/mcp", { method: "POST", token: aircheckToken, body: rpc("tools/list") });
    expect(JSON.parse(r.body).result.tools.map((t: { name: string }) => t.name)).toEqual(["package_submit", "package_revise", "package_get", "episode_mark_rerun", "radar_get", "source_search", "research_submit"]);
  });

  it("/aircheck/mcp refuses an unknown tool name", async () => {
    const r = await send("/aircheck/mcp", {
      method: "POST",
      token: aircheckToken,
      body: rpc("tools/call", { name: "package_approve", arguments: {} }),
    });
    expect(JSON.parse(r.body).error.message).toMatch(/not available/);
  });

  it("/aircheck/mcp package_submit reaches the Convex stub and returns the success text", async () => {
    convexHits.length = 0;
    const args = { showDate: "2026-10-09", tracklistText: "t", leads: ["A"], tags: ["x"], description: "d", hour1Id: "1", hour2Id: "2", extra: "dropped" };
    const r = await send("/aircheck/mcp", {
      method: "POST",
      token: aircheckToken,
      body: rpc("tools/call", { name: "package_submit", arguments: args }),
    });
    const out = JSON.parse(r.body).result;
    expect(out.isError).toBe(false);
    expect(out.content[0].text).toMatch(/^Submitted pkg-stub/);
    expect(convexHits).toHaveLength(1);
    expect(convexHits[0]!.auth).toBe(`Bearer ${"s".repeat(40)}`);
    expect(JSON.parse(convexHits[0]!.body)).not.toHaveProperty("extra");
  });

  it("/aircheck/mcp package_revise reaches the Convex revise route and returns back-in-review text", async () => {
    convexHits.length = 0;
    const r = await send("/aircheck/mcp", {
      method: "POST",
      token: aircheckToken,
      body: rpc("tools/call", { name: "package_revise", arguments: { packageId: "pkg-stub", description: "d", status: "approved" } }),
    });
    const out = JSON.parse(r.body).result;
    expect(out.isError).toBe(false);
    expect(out.content[0].text).toMatch(/^Revised pkg-stub/);
    expect(convexHits).toHaveLength(1);
    expect(convexHits[0]!.url).toBe("/agent/packages/revise");
    expect(convexHits[0]!.auth).toBe(`Bearer ${"s".repeat(40)}`);
    expect(JSON.parse(convexHits[0]!.body)).toEqual({ packageId: "pkg-stub", description: "d" });
  });

  it("/aircheck/mcp package_get reaches the Convex get route with the submit token and returns the package", async () => {
    convexHits.length = 0;
    const r = await send("/aircheck/mcp", {
      method: "POST",
      token: aircheckToken,
      body: rpc("tools/call", { name: "package_get", arguments: { packageId: "pkg-stub" } }),
    });
    const out = JSON.parse(r.body).result;
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content[0].text)).toMatchObject({ packageId: "pkg-stub" });
    expect(convexHits).toHaveLength(1);
    expect(convexHits[0]!.url).toBe("/agent/packages/get");
    expect(convexHits[0]!.auth).toBe(`Bearer ${"s".repeat(40)}`);
  });

  it("/aircheck-demo/mcp lists package_submit and submits with the demo Convex token", async () => {
    const list = await send("/aircheck-demo/mcp", { method: "POST", token: demoToken, body: rpc("tools/list") });
    expect(JSON.parse(list.body).result.tools.map((t: { name: string }) => t.name)).toEqual(["package_submit", "package_revise", "package_get", "episode_mark_rerun", "radar_get", "source_search", "research_submit"]);
    convexHits.length = 0;
    const args = { showDate: "2026-10-09", tracklistText: "t", leads: ["A"], tags: ["x"], description: "d", hour1Id: "1", hour2Id: "2" };
    const r = await send("/aircheck-demo/mcp", {
      method: "POST",
      token: demoToken,
      body: rpc("tools/call", { name: "package_submit", arguments: args }),
    });
    expect(JSON.parse(r.body).result.isError).toBe(false);
    expect(convexHits).toHaveLength(1);
    expect(convexHits[0]!.auth).toBe(`Bearer ${"m".repeat(40)}`);
  });

  it("keeps the real and demo MCP tokens apart", async () => {
    const onDemo = await send("/aircheck-demo/mcp", { method: "POST", token: aircheckToken, body: rpc("tools/list") });
    expect(onDemo.status).toBe(401);
    const onReal = await send("/aircheck/mcp", { method: "POST", token: demoToken, body: rpc("tools/list") });
    expect(onReal.status).toBe(401);
  });

  it("Crate results carry source ids that research_submit on /aircheck/mcp resolves (one ledger)", async () => {
    const crate = await send("/crate/mcp", { method: "POST", token: crateToken, body: rpc("tools/call", { name: "wikipedia_links", arguments: {} }) });
    const content = JSON.parse(crate.body).result.content as { text: string }[];
    const sources = content.at(-1)!.text;
    // R8b: the off-family link (label.example) gets no id.
    expect(sources).toMatch(/^Sources:\n\[S[0-9a-z]{5}\] en\.wikipedia\.org$/);
    const ids = [...sources.matchAll(/\[(S[0-9a-z]{5})\]/g)].map((m) => m[1]!);
    convexHits.length = 0;
    const claim = { kind: "release-date", text: "Album A came out on 2026-10-10.", value: "2026-10-10", sources: ids.map((id) => ({ id })) };
    const r = await send("/aircheck/mcp", { method: "POST", token: aircheckToken, body: rpc("tools/call", { name: "research_submit", arguments: { job: "rj-abc123", key: "H1.1", claims: [claim] } }) });
    const out = JSON.parse(r.body).result;
    expect(out.content[0].text).toBe("Saved H1.1: 1 claim (0 marked [verify]).");
    expect(convexHits).toHaveLength(1);
    expect(convexHits[0]!.url).toBe("/agent/research");
    expect(convexHits[0]!.auth).toBe(`Bearer ${"s".repeat(40)}`);
    const posted = JSON.parse(convexHits[0]!.body);
    expect(Object.values(posted.sources).map((s) => (s as { url: string }).url)).toEqual(["https://en.wikipedia.org/wiki/Album_A"]);
  });

  it("source_search without a Tavily key answers plainly and calls nothing", async () => {
    convexHits.length = 0;
    const r = await send("/aircheck-demo/mcp", { method: "POST", token: demoToken, body: rpc("tools/call", { name: "source_search", arguments: { query: "artist a" } }) });
    expect(JSON.parse(r.body).result.content[0].text).toBe("Web search is not configured on the bridge. Tell the operator; do not retry.");
    expect(convexHits).toHaveLength(0);
  });

  it("has no /aircheck-demo/mcp route when the demo pair is unset", async () => {
    const demo = await send("/aircheck-demo/mcp", { method: "POST", token: demoToken, body: rpc("tools/list"), port: barePort });
    expect(demo.status).toBe(404);
    const real = await send("/aircheck/mcp", { method: "POST", token: aircheckToken, body: rpc("tools/list"), port: barePort });
    expect(real.status).toBe(200);
  });
});
