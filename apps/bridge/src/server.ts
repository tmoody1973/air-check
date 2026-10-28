import { readFileSync, realpathSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server as HttpsServer } from "node:https";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { packageReviseTool, packageSubmitTool } from "./aircheckTools.js";
import { bearerOk } from "./auth.js";
import { loadConfig, type BridgeConfig } from "./config.js";
import { createCrateProxy } from "./crateProxy.js";

const MAX_BODY = 131_072; // NemoClaw's MCP policy cap on request bodies

interface Endpoint {
  token: string;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: unknown): Promise<CallToolResult>;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

// Tool names come from the agent; keep them to one tidy log token.
const logName = (name: string) => name.replace(/[^\w.-]/g, "?").slice(0, 64);

function mcpServer(ep: Endpoint): Server {
  const server = new Server({ name: "aircheck-bridge", version: "0.1.0" }, { capabilities: { tools: {} } });
  // Low-level handlers, so Crate's schemas pass through untouched.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await ep.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const start = Date.now();
    let ok = false;
    try {
      const result = await ep.callTool(req.params.name, req.params.arguments);
      ok = !result.isError;
      return result;
    } finally {
      // Hard Rule 8: tool name and outcome only, never arguments.
      console.log(`tool=${logName(req.params.name)} ok=${ok} ms=${Date.now() - start}`);
    }
  });
  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) throw new HttpError(413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413);
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400);
  }
  if (Array.isArray(body)) throw new HttpError(400); // one JSON-RPC message per request, no batches
  return body;
}

function reply(res: ServerResponse, status: number, body = "", headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "text/plain", ...headers }).end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse, routes: Record<string, Endpoint>) {
  const path = new URL(req.url ?? "/", "https://bridge").pathname;
  if (path === "/healthz" && req.method === "GET") return reply(res, 200, "ok");
  const ep = Object.hasOwn(routes, path) ? routes[path] : undefined;
  if (!ep) return reply(res, 404);
  if (!bearerOk(req.headers.authorization, ep.token)) return reply(res, 401);
  // Stateless JSON responses: no GET SSE stream, no DELETE session.
  if (req.method !== "POST") return reply(res, 405, "", { allow: "POST" });

  const body = await readJson(req);
  const server = mcpServer(ep);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

/** The private HTTPS bridge: /crate/mcp (allowlisted Crate) and /aircheck/mcp (package_submit, package_revise),
 * and /aircheck-demo/mcp (the same tools, demo workspace) when the demo token pair is configured. */
export function startServer(config: BridgeConfig): Promise<HttpsServer> {
  const crate = createCrateProxy(config.crate);
  const submitEndpoint = (token: string, submitToken: string): Endpoint => {
    const tools = [packageSubmitTool, packageReviseTool].map((make) => make({ siteUrl: config.convexSiteUrl, token: submitToken }));
    return {
      token,
      listTools: async () => tools.map((t) => t.tool),
      callTool: async (name, args) => {
        const t = tools.find((x) => x.tool.name === name);
        if (!t) throw new Error(`Tool ${name} is not available`);
        return t.call(args);
      },
    };
  };
  const routes: Record<string, Endpoint> = {
    "/crate/mcp": { token: config.crateMcpToken, listTools: crate.listTools, callTool: crate.callTool },
    "/aircheck/mcp": submitEndpoint(config.aircheckMcpToken, config.agentSubmitToken),
  };
  // The judges' demo sandbox: its own MCP token, and a Convex token that lands in the demo workspace.
  if (config.demoMcpToken && config.demoSubmitToken)
    routes["/aircheck-demo/mcp"] = submitEndpoint(config.demoMcpToken, config.demoSubmitToken);

  const server = createServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) }, (req, res) => {
    handle(req, res, routes).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(`request failed: ${e instanceof Error ? e.name : "unknown"}`);
      if (!res.headersSent) reply(res, status, "", { connection: "close" });
    });
  });
  server.on("close", () => void crate.close());

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve(server));
  });
}

// `node dist/server.js` (systemd, Task 6) starts the bridge; importing this module does not.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const fail = (e: unknown) => {
    console.error(`bridge failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  };
  try {
    const config = loadConfig(process.env);
    startServer(config).then(() => console.log(`bridge listening on ${config.host}:${config.port}`), fail);
  } catch (e) {
    fail(e);
  }
}
