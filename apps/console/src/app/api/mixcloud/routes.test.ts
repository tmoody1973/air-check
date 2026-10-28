import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATE_COOKIE } from "@/lib/mixcloudOAuth";

// The signed-in session and the server-side Convex call are faked; everything else is real.
const session = vi.hoisted(() => ({ current: null as null | { userId: string; sessionClaims: Record<string, unknown> } }));
const getToken = vi.hoisted(() => vi.fn(async () => "convex-jwt"));
const fetchMutation = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: session.current?.userId ?? null, sessionClaims: session.current?.sessionClaims ?? null, getToken }),
}));
vi.mock("convex/nextjs", () => ({ fetchMutation }));

const STAFF = { userId: "u1", sessionClaims: { aud: "convex", email: "dj@radiomilwaukee.org", email_verified: true } };
const DEMO = { userId: "d1", sessionClaims: { aud: "convex", role: "demo", email: "demo@example.com", email_verified: true } };
const OUTSIDER = { userId: "x1", sessionClaims: { aud: "convex", email: "someone@gmail.com", email_verified: true } };
const UNVERIFIED = { userId: "u2", sessionClaims: { aud: "convex", email: "dj@radiomilwaukee.org", email_verified: false } };

let dir: string;
let tokenFile: string;
const logs: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mixcloud-route-"));
  tokenFile = join(dir, "token.json");
  vi.stubEnv("MIXCLOUD_CLIENT_ID", "cid");
  vi.stubEnv("MIXCLOUD_CLIENT_SECRET", "csecret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://air.example");
  vi.stubEnv("MIXCLOUD_TOKEN_FILE", tokenFile);
  session.current = STAFF;
  getToken.mockClear();
  fetchMutation.mockReset().mockResolvedValue(null);
  logs.length = 0;
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const setCookies = (res: Response) => res.headers.getSetCookie();

describe("POST /api/mixcloud/authorize", () => {
  const call = async (origin: string | null = "https://air.example") => {
    const mod = (await import("./authorize/route")) as Record<string, unknown>;
    const POST = mod.POST as (r: Request) => Promise<Response>;
    return POST(new Request("http://internal:3000/api/mixcloud/authorize", { method: "POST", headers: origin ? { origin } : {} }));
  };

  it("GET is not served, so a cross-site link can't start a connect", async () => {
    expect(Object.keys(await import("./authorize/route"))).toEqual(["POST"]);
  });

  it("a same-origin POST by a staff member → 303 to Mixcloud with a fresh state cookie", async () => {
    const res = await call();
    expect(res.status).toBe(303);
    const [cookie] = setCookies(res);
    expect(cookie).toMatch(new RegExp(`^${STATE_COOKIE}=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=/api/mixcloud; Max-Age=600$`));
    const state = cookie!.split(";")[0]!.split("=")[1];
    expect(res.headers.get("location")).toBe(
      `https://www.mixcloud.com/oauth/authorize?client_id=cid&redirect_uri=https%3A%2F%2Fair.example%2Fapi%2Fmixcloud%2Fcallback&state=${state}`,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([["no Origin", null], ["a foreign Origin", "https://evil.example"]])("%s → 403 and no cookie", async (_l, origin) => {
    const res = await call(origin);
    expect(res.status).toBe(403);
    expect(setCookies(res)).toEqual([]);
  });

  it.each([["demo", DEMO], ["an outside account", OUTSIDER], ["an unverified email", UNVERIFIED], ["signed out", null]])(
    "%s (same origin) gets 403 and no cookie",
    async (_label, who) => {
      session.current = who;
      const res = await call();
      expect(res.status).toBe(403);
      expect(setCookies(res)).toEqual([]);
    },
  );

  it("missing Mixcloud settings redirect with reason=config", async () => {
    vi.stubEnv("MIXCLOUD_CLIENT_SECRET", "");
    const res = await call();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/settings?mixcloud=error&reason=config");
    expect(setCookies(res)).toEqual([]);
  });
});

describe("GET /api/mixcloud/callback", () => {
  const STATE = "s".repeat(43);
  const call = async (query = "?code=thecode", cookie: string | null = `${STATE_COOKIE}=${STATE}`) => {
    const { GET } = await import("./callback/route");
    return GET(new Request(`http://internal:3000/api/mixcloud/callback${query}`, { headers: cookie ? { cookie } : {} }));
  };
  const mixcloud = (token = "access_token=SECRETTOKEN", me: unknown = { username: "rhythmlab" }) => {
    const f = vi.fn(async (url: string) => (url.startsWith("https://www.mixcloud.com/oauth/access_token") ? new Response(token) : Response.json(me)));
    vi.stubGlobal("fetch", f);
    return f;
  };
  const expectCleared = (res: Response) =>
    expect(setCookies(res)).toEqual([`${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/mixcloud; Max-Age=0`]);
  const expectError = (res: Response, reason: string) => {
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/settings?mixcloud=error&reason=${reason}`);
    expectCleared(res);
  };

  it("exchanges the code, writes the token file (640), records the account and redirects", async () => {
    const f = mixcloud();
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings?mixcloud=connected");
    expectCleared(res);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://www.mixcloud.com/oauth/access_token?client_id=cid&redirect_uri=https%3A%2F%2Fair.example%2Fapi%2Fmixcloud%2Fcallback&client_secret=csecret&code=thecode",
      "https://api.mixcloud.com/me/?access_token=SECRETTOKEN",
    ]);
    const saved = JSON.parse(await readFile(tokenFile, "utf8"));
    expect(saved).toEqual({ access_token: "SECRETTOKEN", account: "rhythmlab", connectedAt: expect.any(Number) });
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o640);
    expect(fetchMutation).toHaveBeenCalledWith(expect.anything(), { account: "rhythmlab" }, { token: "convex-jwt" });
    expect(JSON.stringify(fetchMutation.mock.calls)).not.toContain("SECRETTOKEN");
    expect(logs.join("\n")).not.toMatch(/SECRETTOKEN|csecret|thecode/);
    expect(logs.every((l) => /^mixcloud step=\w+ ok=(true|false)$/.test(l))).toBe(true);
  });

  it("asks Clerk for the convex template token when the session token is not for Convex", async () => {
    mixcloud();
    session.current = { ...STAFF, sessionClaims: { ...STAFF.sessionClaims, aud: undefined } };
    await call();
    expect(getToken).toHaveBeenCalledWith({ template: "convex" });
  });

  it.each([
    ["no cookie", "?code=c", null],
    ["an empty cookie", "?code=c", `${STATE_COOKIE}=`],
    ["an echoed state that differs", `?code=c&state=${"t".repeat(43)}`, `${STATE_COOKIE}=${STATE}`],
    ["an echoed state one character longer", `?code=c&state=${STATE}x`, `${STATE_COOKIE}=${STATE}`],
    ["an empty echoed state", "?code=c&state=", `${STATE_COOKIE}=${STATE}`],
  ])("state mismatch (%s) → reason=state, nothing exchanged", async (_l, query, cookie) => {
    const f = mixcloud();
    expectError(await call(query, cookie), "state");
    expect(f).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });

  it("an echoed state that matches is accepted", async () => {
    mixcloud();
    expect((await call(`?code=c&state=${STATE}`)).headers.get("location")).toBe("/settings?mixcloud=connected");
  });

  it.each([["demo", DEMO], ["an outside account", OUTSIDER], ["signed out", null]])("%s gets 403 and the cookie is cleared", async (_l, who) => {
    session.current = who;
    const f = mixcloud();
    const res = await call();
    expect(res.status).toBe(403);
    expectCleared(res);
    expect(f).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("a denied consent → reason=denied", async () => {
    mixcloud();
    expectError(await call("?error=access_denied"), "denied");
  });

  it("missing settings → reason=config", async () => {
    vi.stubEnv("MIXCLOUD_CLIENT_ID", "");
    expectError(await call(), "config");
  });

  it("a bad token response → reason=exchange", async () => {
    mixcloud("error=invalid_grant");
    expectError(await call(), "exchange");
    expect(await readdir(dir)).toEqual([]);
  });

  it("a /me/ failure → reason=profile, and the token is not written", async () => {
    mixcloud(undefined, { error: "nope" });
    expectError(await call(), "profile");
    expect(await readdir(dir)).toEqual([]);
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("an unwritable token folder → reason=write, Convex untouched", async () => {
    mixcloud();
    vi.stubEnv("MIXCLOUD_TOKEN_FILE", join(dir, "missing", "token.json"));
    expectError(await call(), "write");
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("a Convex failure → reason=status", async () => {
    mixcloud();
    fetchMutation.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expectError(await call(), "status");
  });
});

describe("POST /api/mixcloud/disconnect", () => {
  const call = async (origin: string | null = "https://air.example") => {
    const { POST } = await import("./disconnect/route");
    return POST(new Request("http://internal:3000/api/mixcloud/disconnect", { method: "POST", headers: origin ? { origin } : {} }));
  };

  it("deletes the token file, records not_connected and redirects back", async () => {
    await writeFile(tokenFile, "{}");
    const res = await call();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/settings?mixcloud=disconnected");
    expect(await readdir(dir)).toEqual([]);
    expect(fetchMutation).toHaveBeenCalledWith(expect.anything(), {}, { token: "convex-jwt" });
  });

  it("succeeds when there is no file", async () => {
    expect((await call()).headers.get("location")).toBe("/settings?mixcloud=disconnected");
  });

  it.each([["no Origin", null], ["another origin", "https://evil.example"]])("%s → 403, file kept", async (_l, origin) => {
    await writeFile(tokenFile, "{}");
    expect((await call(origin)).status).toBe(403);
    expect(await readdir(dir)).toEqual(["token.json"]);
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it.each([["demo", DEMO], ["signed out", null]])("%s → 403, file kept", async (_l, who) => {
    session.current = who;
    await writeFile(tokenFile, "{}");
    expect((await call()).status).toBe(403);
    expect(await readdir(dir)).toEqual(["token.json"]);
  });

  it("a Convex failure → reason=status", async () => {
    fetchMutation.mockRejectedValueOnce(new Error("x"));
    const res = await call();
    expect(res.headers.get("location")).toBe("/settings?mixcloud=error&reason=status");
  });
});
