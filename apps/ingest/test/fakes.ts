import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Http } from "../src/http.js";

export interface Seen { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"]; body: string }
export type Handler = (req: Seen, res: ServerResponse) => void | Promise<void>;

export const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

/**
 * A fake provider on 127.0.0.1. Routes are "METHOD /path"; a route given a list answers with its handlers in order, the
 * last one repeating. Every request is recorded. Stands in for Box, Google, Dropbox and dl.boxcloud.com.
 */
export async function fakeServer(routes: Record<string, Handler | Handler[]>) {
  const seen: Seen[] = [];
  const count = new Map<string, number>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const s: Seen = { method: req.method ?? "", path: url.pathname, query: url.searchParams, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
    seen.push(s);
    const key = `${s.method} ${s.path}`;
    const route = routes[key];
    if (!route) return json(res, 404, { error: "no route", key });
    const list = Array.isArray(route) ? route : [route];
    const n = count.get(key) ?? 0;
    count.set(key, n + 1);
    try {
      await list[Math.min(n, list.length - 1)]!(s, res);
    } catch {
      if (!res.headersSent) json(res, 500, {});
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base, seen,
    calls: (key: string) => seen.filter((x) => `${x.method} ${x.path}` === key),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Real fetch, recorded sleeps (a 429 never really waits in a test). */
export function testHttp(): Http & { slept: number[] } {
  const slept: number[] = [];
  return { fetch: (i, init) => fetch(i, init), sleep: async (ms) => void slept.push(ms), slept };
}

export const form = (s: Seen) => Object.fromEntries(new URLSearchParams(s.body));
