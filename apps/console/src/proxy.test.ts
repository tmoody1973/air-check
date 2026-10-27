import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

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
});
