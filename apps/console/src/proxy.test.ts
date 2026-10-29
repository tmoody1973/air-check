import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Clearly fake keys: clerkMiddleware needs them to construct, nothing here reaches the network.
// A live-style key keeps Clerk from starting its dev-instance handshake redirect.
const FAKE_PK = `pk_live_${Buffer.from("fake.example.test$").toString("base64")}`;

async function run(path: string) {
  const { default: proxy } = await import("./proxy");
  const req = new NextRequest(`http://localhost:3000${path}`, { headers: { accept: "text/html" } });
  // @ts-expect-error clerkMiddleware's handler takes (req, event)
  const res = await proxy(req, { waitUntil() {} });
  if (!res) throw new Error("proxy returned no response");
  return res;
}

describe("proxy", () => {
  beforeAll(() => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", FAKE_PK);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_fake_not_a_real_key");
    vi.stubEnv("CLERK_TELEMETRY_DISABLED", "1");
  });

  it("protected route redirects with redirect_url", async () => {
    const res = await run("/packages/abc");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const loc = new URL(res.headers.get("location")!, "http://localhost:3000");
    expect(loc.pathname).toBe("/sign-in");
    expect(loc.searchParams.get("redirect_url")).toMatch(/\/packages\/abc$/);
  });

  it("/demo is public", async () => {
    const res = await run("/demo");
    expect(res.headers.get("location")).toBeNull();
  });

  it("/sign-in is public", async () => {
    const res = await run("/sign-in");
    expect(res.headers.get("location")).toBeNull();
  });

  // AgentMail's webhook has no session; its own check is the Svix signature in the route.
  it("/api/agentmail/inbound is reachable without a session", async () => {
    const res = await run("/api/agentmail/inbound");
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("exactly that path: other /api/agentmail paths still need a session", async () => {
    for (const path of ["/api/agentmail/other", "/api/agentmail/inbound/x", "/api/agentmail"]) {
      const res = await run(path);
      expect(res.headers.get("location") !== null || res.status === 404, path).toBe(true);
    }
  });
});

describe("proxy options", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@clerk/nextjs/server");
  });

  async function optionsFor(appUrl: string) {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", appUrl);
    const clerkMiddleware = vi.fn(() => () => undefined);
    vi.resetModules();
    vi.doMock("@clerk/nextjs/server", async (orig) => ({ ...(await orig<object>()), clerkMiddleware }));
    await import("./proxy");
    return (clerkMiddleware.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
  }

  it("authorizedParties set from NEXT_PUBLIC_APP_URL", async () => {
    const opts = await optionsFor("https://aircheck.rhythmlabradio.com");
    expect(opts.authorizedParties).toEqual(["https://aircheck.rhythmlabradio.com"]);
  });

  it("sets no authorizedParties when NEXT_PUBLIC_APP_URL is unset", async () => {
    const opts = await optionsFor("");
    expect(opts.authorizedParties).toBeUndefined();
  });
});

// Plan 8: the Release radar embeds Bandcamp's own player in an iframe. The console sets no Content-Security-Policy
// today, so nothing blocks it. A CSP added later must allow it, or every player silently goes blank.
describe("CSP note (Bandcamp player)", () => {
  const NOTE = "A Content-Security-Policy now exists: include frame-src https://bandcamp.com so the Release radar's Bandcamp player still loads, then update this test.";

  it("next.config.ts sets no Content-Security-Policy header", async () => {
    const { readFileSync } = await import("node:fs");
    const { default: config } = await import("../next.config");
    const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    expect(config.headers, NOTE).toBeUndefined();
    expect(/content-security-policy/i.test(source), NOTE).toBe(false);
  });

  it("the proxy adds none either", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", FAKE_PK);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_fake_not_a_real_key");
    const res = await run("/demo");
    expect(res.headers.get("content-security-policy"), NOTE).toBeNull();
    vi.unstubAllEnvs();
  });
});
