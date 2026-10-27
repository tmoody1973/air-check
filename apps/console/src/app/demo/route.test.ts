import { beforeEach, describe, expect, it, vi } from "vitest";

const createSignInToken = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ signInTokens: { createSignInToken } }),
}));

async function get(ip = "10.0.0.1") {
  const { GET } = await import("./route");
  return GET(new Request("http://internal:3000/demo", { headers: { "x-real-ip": ip } }));
}

describe("GET /demo", () => {
  beforeEach(() => {
    vi.resetModules();
    createSignInToken.mockReset();
    vi.stubEnv("AIRCHECK_DEMO_USER_ID", "user_demo_fake");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("demo redirect is relative", async () => {
    createSignInToken.mockResolvedValue({ token: "tok_fake" });
    const res = await get();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sign-in?__clerk_ticket=tok_fake&redirect_url=/today");
  });

  it("demo returns 503 when Clerk fails", async () => {
    createSignInToken.mockRejectedValue(new Error("clerk down"));
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("The demo is unavailable right now.");
  });

  it("demo returns 503 when the demo user is not configured", async () => {
    vi.stubEnv("AIRCHECK_DEMO_USER_ID", "");
    const res = await get();
    expect(res.status).toBe(503);
    expect(createSignInToken).not.toHaveBeenCalled();
  });

  it("demo mints a 60 s token for the demo user only", async () => {
    createSignInToken.mockResolvedValue({ token: "tok_fake" });
    await get();
    expect(createSignInToken).toHaveBeenCalledWith({ userId: "user_demo_fake", expiresInSeconds: 60 });
  });

  it("demo returns 429 after 10 in a minute", async () => {
    createSignInToken.mockResolvedValue({ token: "tok_fake" });
    for (let i = 0; i < 10; i++) expect((await get("7.7.7.7")).status).toBe(302);
    expect((await get("7.7.7.7")).status).toBe(429);
  });
});
