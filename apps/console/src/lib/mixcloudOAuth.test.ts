import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLEAR_STATE_COOKIE,
  STATE_COOKIE,
  accessTokenUrl,
  authorizeUrl,
  errorLocation,
  exchangeCode,
  fetchAccount,
  mixcloudConfig,
  newState,
  parseTokenResponse,
  readCookie,
  removeTokenFile,
  sameOrigin,
  stateCookie,
  statesMatch,
  tokenFilePath,
  writeTokenFile,
} from "./mixcloudOAuth";

const cfg = { clientId: "cid 1", clientSecret: "sec&ret", redirectUri: "https://air.example/api/mixcloud/callback" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("config", () => {
  it("builds the redirect URI once from the app origin", () => {
    vi.stubEnv("MIXCLOUD_CLIENT_ID", "id");
    vi.stubEnv("MIXCLOUD_CLIENT_SECRET", "secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://air.example/today");
    expect(mixcloudConfig()).toEqual({ clientId: "id", clientSecret: "secret", redirectUri: "https://air.example/api/mixcloud/callback" });
  });

  it.each(["MIXCLOUD_CLIENT_ID", "MIXCLOUD_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL"])("is null when %s is missing", (name) => {
    vi.stubEnv("MIXCLOUD_CLIENT_ID", "id");
    vi.stubEnv("MIXCLOUD_CLIENT_SECRET", "secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://air.example");
    vi.stubEnv(name, "");
    expect(mixcloudConfig()).toBeNull();
  });

  it("token file defaults to /mixcloud/token.json", () => {
    vi.stubEnv("MIXCLOUD_TOKEN_FILE", "");
    expect(tokenFilePath()).toBe("/mixcloud/token.json");
    vi.stubEnv("MIXCLOUD_TOKEN_FILE", "/x/t.json");
    expect(tokenFilePath()).toBe("/x/t.json");
  });
});

describe("URLs", () => {
  it("authorize URL carries the client id, the encoded redirect URI and the state, nothing secret", () => {
    const u = authorizeUrl(cfg, "st_1");
    expect(u).toBe(
      "https://www.mixcloud.com/oauth/authorize?client_id=cid+1&redirect_uri=https%3A%2F%2Fair.example%2Fapi%2Fmixcloud%2Fcallback&state=st_1",
    );
    expect(u).not.toContain("sec");
  });

  it("access-token URL uses the same redirect URI and encodes every value", () => {
    const u = new URL(accessTokenUrl(cfg, "a/b&c"));
    expect(u.origin + u.pathname).toBe("https://www.mixcloud.com/oauth/access_token");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: "cid 1", redirect_uri: cfg.redirectUri, client_secret: "sec&ret", code: "a/b&c",
    });
  });

  it("error redirects use a fixed reason code", () => {
    expect(errorLocation("state")).toBe("/settings?mixcloud=error&reason=state");
  });
});

describe("state cookie", () => {
  it("is 32 random bytes in base64url, different each time", () => {
    const a = newState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newState()).not.toBe(a);
  });

  it("is HttpOnly, Secure, SameSite=Lax, scoped to /api/mixcloud, 10 minutes", () => {
    expect(stateCookie("abc")).toBe(`${STATE_COOKIE}=abc; HttpOnly; Secure; SameSite=Lax; Path=/api/mixcloud; Max-Age=600`);
    expect(CLEAR_STATE_COOKIE).toBe(`${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/mixcloud; Max-Age=0`);
  });

  it("reads one cookie out of a Cookie header", () => {
    expect(readCookie(`a=1; ${STATE_COOKIE}=xyz; b=2`, STATE_COOKIE)).toBe("xyz");
    expect(readCookie("a=1", STATE_COOKIE)).toBeUndefined();
    expect(readCookie(null, STATE_COOKIE)).toBeUndefined();
  });

  it("matches only identical non-empty values", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });
});

describe("same origin", () => {
  const post = (origin?: string) => new Request("http://internal:3000/api/mixcloud/disconnect", { method: "POST", headers: origin ? { origin } : {} });
  it("requires the Origin header to equal the app origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://air.example");
    expect(sameOrigin(post("https://air.example"))).toBe(true);
    expect(sameOrigin(post("https://evil.example"))).toBe(false);
    expect(sameOrigin(post())).toBe(false);
  });
  it("refuses when the app origin is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(sameOrigin(post("http://internal:3000"))).toBe(false);
  });
});

describe("token response", () => {
  it.each([
    ["access_token=abc123", "abc123"],
    ["access_token=abc%2B1&expires=0", "abc+1"],
    ['{"access_token":"abc123"}', "abc123"],
    ['  {"access_token":"j"}\n', "j"],
  ])("parses %s", (body, token) => expect(parseTokenResponse(body)).toBe(token));

  it.each([["access_token="], ["error=invalid"], ['{"access_token":""}'], ['{"access_token":5}'], ["{not json"], [""], ["null"]])(
    "rejects %s",
    (body) => expect(parseTokenResponse(body)).toBeNull(),
  );
});

describe("Mixcloud calls", () => {
  it("exchangeCode returns the token, or null on a non-2xx, a throw or an empty token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("access_token=tok"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await exchangeCode(cfg, "c")).toBe("tok");
    expect(fetchMock.mock.calls[0]![0]).toBe(accessTokenUrl(cfg, "c"));
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockResolvedValueOnce(new Response("access_token=tok", { status: 400 }));
    expect(await exchangeCode(cfg, "c")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await exchangeCode(cfg, "c")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('{"error":"x"}'));
    expect(await exchangeCode(cfg, "c")).toBeNull();
  });

  it("fetchAccount reads the username from /me/", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ username: "rhythmlab", name: "Rhythm Lab" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAccount("t ok")).toBe("rhythmlab");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.mixcloud.com/me/?access_token=t+ok");
    fetchMock.mockResolvedValueOnce(Response.json({ name: "no username" }));
    expect(await fetchAccount("t")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    expect(await fetchAccount("t")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await fetchAccount("t")).toBeNull();
  });
});

describe("token file", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mixcloud-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes the JSON atomically with mode 640, replacing an older file and leaving no temp file", async () => {
    const file = join(dir, "token.json");
    await writeFile(file, "old", { mode: 0o600 });
    const old = process.umask(0o077); // a strict umask must not narrow the mode
    try {
      await writeTokenFile(file, { access_token: "tok", account: "rhythmlab", connectedAt: 123 });
    } finally {
      process.umask(old);
    }
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ access_token: "tok", account: "rhythmlab", connectedAt: 123 });
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    expect(await readdir(dir)).toEqual(["token.json"]);
  });

  it("a failed write leaves no temp file behind", async () => {
    await expect(writeTokenFile(join(dir, "missing", "token.json"), { access_token: "t", account: "a", connectedAt: 1 })).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it("remove deletes the file and ignores a missing one", async () => {
    const file = join(dir, "token.json");
    await writeFile(file, "x");
    await removeTokenFile(file);
    expect(await readdir(dir)).toEqual([]);
    await expect(removeTokenFile(file)).resolves.toBeUndefined();
  });
});
