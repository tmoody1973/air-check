import { describe, expect, test, vi } from "vitest";
import { bridgePrefetch } from "../src/bridge.js";

const cfg = { url: "https://bridge.example:8443", tokens: { real: "r".repeat(40), demo: "d".repeat(40) } };

describe("bridgePrefetch (Oct 29)", () => {
  test("posts the job id to the workspace's prefetch route with that route's MCP token", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const start = bridgePrefetch(cfg, fetch as typeof globalThis.fetch);
    await start("real", "rj-abc123");
    await start("demo", "rj-def456");
    const calls = fetch.mock.calls as unknown as [URL, RequestInit][];
    expect(calls.map(([u]) => String(u))).toEqual(["https://bridge.example:8443/aircheck/prefetch", "https://bridge.example:8443/aircheck-demo/prefetch"]);
    expect((calls[0]![1].headers as Record<string, string>).authorization).toBe(`Bearer ${"r".repeat(40)}`);
    expect((calls[1]![1].headers as Record<string, string>).authorization).toBe(`Bearer ${"d".repeat(40)}`);
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ job: "rj-abc123" });
  });

  test("a 204 (nothing to prefetch) is fine; any other non-2xx throws without the token", async () => {
    await expect(bridgePrefetch(cfg, (async () => new Response(null, { status: 204 })) as typeof fetch)("real", "rj-a")).resolves.toBeUndefined();
    const err = bridgePrefetch(cfg, (async () => new Response(null, { status: 502 })) as typeof fetch)("real", "rj-a");
    await expect(err).rejects.toThrow("bridge prefetch HTTP 502");
    await expect(err).rejects.not.toThrow(/rrrr/);
  });

  test("a workspace with no token makes no call", async () => {
    const fetch = vi.fn();
    await bridgePrefetch({ url: cfg.url, tokens: { real: "r".repeat(40) } }, fetch)("demo", "rj-a");
    expect(fetch).not.toHaveBeenCalled();
  });
});
