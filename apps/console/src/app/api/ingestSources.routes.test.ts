import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Connect Google Drive and Connect Dropbox (Plan 6 Task 3), built like Connect Mixcloud. The signed-in session and the
// server-side Convex call are faked; the routes, cookies, token files and HTTP shapes are real.
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

const ROUTES = {
  google: {
    authorize: () => import("./google/authorize/route"),
    callback: () => import("./google/callback/route"),
    disconnect: () => import("./google/disconnect/route"),
    env: { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret" },
    authorizeHost: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  dropbox: {
    authorize: () => import("./dropbox/authorize/route"),
    callback: () => import("./dropbox/callback/route"),
    disconnect: () => import("./dropbox/disconnect/route"),
    env: { DROPBOX_APP_KEY: "cid", DROPBOX_APP_SECRET: "csecret" },
    authorizeHost: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
  },
} as const;

let dir: string;
const logs: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ingest-tokens-"));
  for (const r of Object.values(ROUTES)) for (const [k, v] of Object.entries(r.env)) vi.stubEnv(k, v);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://air.example");
  vi.stubEnv("INGEST_TOKEN_DIR", dir);
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

describe.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])("%s", (p) => {
  const R = ROUTES[p];
  const COOKIE = `${p}_oauth_state`;
  const tokenFile = () => join(dir, `${p}.json`);

  describe("POST authorize", () => {
    const call = async (origin: string | null = "https://air.example") => {
      const { POST } = await R.authorize();
      return POST(new Request(`http://internal:3000/api/${p}/authorize`, { method: "POST", headers: origin ? { origin } : {} }));
    };

    it("GET is not served, so a cross-site link can't start a connect", async () => {
      expect(Object.keys(await R.authorize())).toEqual(["POST"]);
    });

    it("a same-origin POST by a staff member → 303 to the provider with a fresh state cookie", async () => {
      const res = await call();
      expect(res.status).toBe(303);
      const [cookie] = setCookies(res);
      expect(cookie).toMatch(new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=/api/${p}; Max-Age=600$`));
      const state = cookie!.split(";")[0]!.split("=")[1];
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin + loc.pathname).toBe(R.authorizeHost);
      expect(loc.searchParams.get("state")).toBe(state);
      expect(loc.searchParams.get("redirect_uri")).toBe(`https://air.example/api/${p}/callback`);
      expect(loc.href).not.toContain("csecret");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it.each([["no Origin", null], ["a foreign Origin", "https://evil.example"]])("%s → 403 and no cookie", async (_l, origin) => {
      const res = await call(origin);
      expect(res.status).toBe(403);
      expect(setCookies(res)).toEqual([]);
    });

    it.each([["demo", DEMO], ["an outside account", OUTSIDER], ["signed out", null]])("%s → 403 and no cookie", async (_l, who) => {
      session.current = who;
      const res = await call();
      expect(res.status).toBe(403);
      expect(setCookies(res)).toEqual([]);
    });

    it("missing app settings → reason=config, no cookie", async () => {
      vi.stubEnv(Object.keys(R.env)[1]!, "");
      const res = await call();
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`/settings?${p}=error&reason=config`);
      expect(setCookies(res)).toEqual([]);
    });
  });

  describe("GET callback", () => {
    const STATE = "s".repeat(43);
    const call = async (query = `?code=thecode&state=${STATE}`, cookie: string | null = `${COOKIE}=${STATE}`) => {
      const { GET } = await R.callback();
      return GET(new Request(`http://internal:3000/api/${p}/callback${query}`, { headers: cookie ? { cookie } : {} }));
    };
    const provider = (body: unknown = { access_token: "ACCESSTOKEN", refresh_token: "REFRESHTOKEN" }, status = 200) => {
      const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
      vi.stubGlobal("fetch", f);
      return f;
    };
    const expectCleared = (res: Response) =>
      expect(setCookies(res)).toEqual([`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/${p}; Max-Age=0`]);
    const expectError = (res: Response, reason: string) => {
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/settings?${p}=error&reason=${reason}`);
      expectCleared(res);
    };

    it("exchanges the code, writes only the refresh token (640), records the account and redirects", async () => {
      const f = provider();
      const res = await call();
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/settings?${p}=connected`);
      expectCleared(res);
      expect(f.mock.calls.map((c) => (c as unknown[])[0])).toEqual([R.tokenUrl]);
      const account = p === "google" ? "Google account" : "Dropbox account";
      expect(JSON.parse(await readFile(tokenFile(), "utf8"))).toEqual({ refresh_token: "REFRESHTOKEN", account, connectedAt: expect.any(Number) });
      expect((await stat(tokenFile())).mode & 0o777).toBe(0o640);
      expect(await readdir(dir)).toEqual([`${p}.json`]);
      expect(fetchMutation).toHaveBeenCalledWith(expect.anything(), { source: p, account }, { token: "convex-jwt" });
      const everything = JSON.stringify([fetchMutation.mock.calls, logs, [...res.headers]]);
      expect(everything).not.toMatch(/ACCESSTOKEN|REFRESHTOKEN|csecret|thecode/);
      expect(logs.every((l) => new RegExp(`^${p} step=\\w+ ok=(true|false)$`).test(l))).toBe(true);
    });

    it.each([
      ["no cookie", `?code=c&state=${STATE}`, null],
      ["an empty cookie", `?code=c&state=${STATE}`, `${COOKIE}=`],
      ["no echoed state", "?code=c", `${COOKIE}=${STATE}`],
      ["an echoed state that differs", `?code=c&state=${"t".repeat(43)}`, `${COOKIE}=${STATE}`],
      ["an echoed state one character longer", `?code=c&state=${STATE}x`, `${COOKIE}=${STATE}`],
      ["the other provider's cookie", `?code=c&state=${STATE}`, `${p === "google" ? "dropbox" : "google"}_oauth_state=${STATE}`],
    ])("state mismatch (%s) → reason=state, nothing exchanged", async (_l, query, cookie) => {
      const f = provider();
      expectError(await call(query, cookie), "state");
      expect(f).not.toHaveBeenCalled();
      expect(await readdir(dir)).toEqual([]);
    });

    it.each([["demo", DEMO], ["an outside account", OUTSIDER], ["signed out", null]])("%s → 403, cookie cleared, nothing exchanged", async (_l, who) => {
      session.current = who;
      const f = provider();
      const res = await call();
      expect(res.status).toBe(403);
      expectCleared(res);
      expect(f).not.toHaveBeenCalled();
      expect(fetchMutation).not.toHaveBeenCalled();
    });

    it("a denied consent → reason=denied", async () => {
      const f = provider();
      expectError(await call(`?error=access_denied&state=${STATE}`), "denied");
      expect(f).not.toHaveBeenCalled();
    });

    it("missing settings → reason=config", async () => {
      vi.stubEnv(Object.keys(R.env)[0]!, "");
      expectError(await call(), "config");
    });

    it("a refused exchange → reason=exchange, nothing written", async () => {
      provider({ error: "invalid_grant" }, 400);
      expectError(await call(), "exchange");
      expect(await readdir(dir)).toEqual([]);
      expect(fetchMutation).not.toHaveBeenCalled();
    });

    it("no refresh token in the answer → reason=no_refresh, nothing written", async () => {
      provider({ access_token: "ACCESSTOKEN" });
      expectError(await call(), "no_refresh");
      expect(await readdir(dir)).toEqual([]);
      expect(fetchMutation).not.toHaveBeenCalled();
    });

    it("an unwritable token folder → reason=write, Convex untouched", async () => {
      provider();
      vi.stubEnv("INGEST_TOKEN_DIR", join(dir, "missing"));
      expectError(await call(), "write");
      expect(fetchMutation).not.toHaveBeenCalled();
    });

    it("a Convex failure → reason=status", async () => {
      provider();
      fetchMutation.mockRejectedValueOnce(new Error("FORBIDDEN"));
      expectError(await call(), "status");
    });
  });

  describe("POST disconnect", () => {
    const call = async (origin: string | null = "https://air.example") => {
      const { POST } = await R.disconnect();
      return POST(new Request(`http://internal:3000/api/${p}/disconnect`, { method: "POST", headers: origin ? { origin } : {} }));
    };

    it("deletes only this provider's file, records not_connected and redirects back", async () => {
      await writeFile(tokenFile(), "{}");
      await writeFile(join(dir, "other.json"), "{}");
      const res = await call();
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`/settings?${p}=disconnected`);
      expect(await readdir(dir)).toEqual(["other.json"]);
      expect(fetchMutation).toHaveBeenCalledWith(expect.anything(), { source: p }, { token: "convex-jwt" });
    });

    it("succeeds when there is no file", async () => {
      expect((await call()).headers.get("location")).toBe(`/settings?${p}=disconnected`);
    });

    it.each([["no Origin", null], ["another origin", "https://evil.example"]])("%s → 403, file kept", async (_l, origin) => {
      await writeFile(tokenFile(), "{}");
      expect((await call(origin)).status).toBe(403);
      expect(await readdir(dir)).toEqual([`${p}.json`]);
      expect(fetchMutation).not.toHaveBeenCalled();
    });

    it.each([["demo", DEMO], ["signed out", null]])("%s → 403, file kept", async (_l, who) => {
      session.current = who;
      await writeFile(tokenFile(), "{}");
      expect((await call()).status).toBe(403);
      expect(await readdir(dir)).toEqual([`${p}.json`]);
    });

    it("a Convex failure → reason=status", async () => {
      fetchMutation.mockRejectedValueOnce(new Error("x"));
      expect((await call()).headers.get("location")).toBe(`/settings?${p}=error&reason=status`);
    });
  });
});
