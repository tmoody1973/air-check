import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeUrl, clearStateCookie, emailFromIdToken, errorLocation, exchangeCode, ingestConfig, stateCookie, stateCookieName, tokenFilePath,
} from "./ingestOAuth";

// Connect Google Drive and Connect Dropbox: read-only access for the ingest service (Plan 6 Task 3).
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const google = { clientId: "gid 1", clientSecret: "gsec&ret", redirectUri: "https://air.example/api/google/callback" };
const dropbox = { clientId: "dkey", clientSecret: "dsecret", redirectUri: "https://air.example/api/dropbox/callback" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: unknown) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;

describe("config", () => {
  it.each([
    ["google", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ["dropbox", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"],
  ] as const)("%s reads its own env names and builds the redirect URI from the app origin", (p, idName, secretName) => {
    vi.stubEnv(idName, "id");
    vi.stubEnv(secretName, "secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://air.example/today");
    expect(ingestConfig(p)).toEqual({ clientId: "id", clientSecret: "secret", redirectUri: `https://air.example/api/${p}/callback` });
    vi.stubEnv(secretName, "");
    expect(ingestConfig(p)).toBeNull();
    vi.stubEnv(secretName, "secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(ingestConfig(p)).toBeNull();
  });

  it("token files live in INGEST_TOKEN_DIR, default /ingest-tokens", () => {
    vi.stubEnv("INGEST_TOKEN_DIR", "");
    expect(tokenFilePath("google")).toBe("/ingest-tokens/google.json");
    vi.stubEnv("INGEST_TOKEN_DIR", "/x/tokens");
    expect(tokenFilePath("dropbox")).toBe("/x/tokens/dropbox.json");
  });
});

describe("URLs and cookies", () => {
  it("Google: drive.readonly only, offline, consent every time, the state; nothing secret", () => {
    const u = new URL(authorizeUrl("google", google, "st_1"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: "gid 1", redirect_uri: google.redirectUri, response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.readonly", access_type: "offline", prompt: "consent", state: "st_1",
    });
    expect(u.href).not.toContain("gsec");
  });

  it("Dropbox: offline, the two read scopes only, the state; nothing secret", () => {
    const u = new URL(authorizeUrl("dropbox", dropbox, "st_2"));
    expect(u.origin + u.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: "dkey", redirect_uri: dropbox.redirectUri, response_type: "code",
      token_access_type: "offline", scope: "files.metadata.read files.content.read", state: "st_2",
    });
    expect(u.href).not.toContain("dsecret");
  });

  it("each provider has its own state cookie, scoped to its own routes", () => {
    expect(stateCookieName("google")).toBe("google_oauth_state");
    expect(stateCookie("google", "abc")).toBe("google_oauth_state=abc; HttpOnly; Secure; SameSite=Lax; Path=/api/google; Max-Age=600");
    expect(clearStateCookie("dropbox")).toBe("dropbox_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/dropbox; Max-Age=0");
  });

  it("errors redirect to Settings with a fixed reason code", () => {
    expect(errorLocation("google", "no_refresh")).toBe("/settings?google=error&reason=no_refresh");
  });
});

describe("account label from the id_token", () => {
  it("reads the email claim, display only", () => {
    expect(emailFromIdToken(idToken({ email: "tarik@radiomilwaukee.org" }))).toBe("tarik@radiomilwaukee.org");
  });
  it.each([[undefined], [""], ["not.a.jwt"], ["a.b"], [idToken({ sub: "1" })], [idToken({ email: 5 })], [idToken({ email: "x".repeat(201) })], [42]])(
    "is null for %s",
    (t) => expect(emailFromIdToken(t)).toBeNull(),
  );
});

describe("exchangeCode", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("Google: form POST with the secret in the body; keeps the refresh token and the id_token's email", async () => {
    const f = ok({ access_token: "AT", refresh_token: "RT", expires_in: 3599, id_token: idToken({ email: "tarik@radiomilwaukee.org" }) });
    vi.stubGlobal("fetch", f);
    expect(await exchangeCode("google", google, "c/1")).toEqual({ refreshToken: "RT", account: "tarik@radiomilwaukee.org" });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: "gid 1", client_secret: "gsec&ret", code: "c/1", grant_type: "authorization_code", redirect_uri: google.redirectUri,
    });
  });

  it("Google without an id_token is labelled 'Google account'", async () => {
    vi.stubGlobal("fetch", ok({ access_token: "AT", refresh_token: "RT" }));
    expect(await exchangeCode("google", google, "c")).toEqual({ refreshToken: "RT", account: "Google account" });
  });

  it("Dropbox: exchanges at api.dropboxapi.com and is labelled 'Dropbox account'", async () => {
    const f = ok({ access_token: "AT", refresh_token: "RT", account_id: "dbid:1" });
    vi.stubGlobal("fetch", f);
    expect(await exchangeCode("dropbox", dropbox, "c")).toEqual({ refreshToken: "RT", account: "Dropbox account" });
    expect((f.mock.calls[0] as unknown[])[0]).toBe("https://api.dropboxapi.com/oauth2/token");
  });

  it("an answer without a refresh token is no_refresh", async () => {
    vi.stubGlobal("fetch", ok({ access_token: "AT" }));
    expect(await exchangeCode("google", google, "c")).toBe("no_refresh");
    vi.stubGlobal("fetch", ok({ access_token: "AT", refresh_token: "" }));
    expect(await exchangeCode("dropbox", dropbox, "c")).toBe("no_refresh");
  });

  it("a non-2xx, non-JSON answer or a network failure is exchange", async () => {
    vi.stubGlobal("fetch", ok({ refresh_token: "RT" }, 400));
    expect(await exchangeCode("google", google, "c")).toBe("exchange");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>")));
    expect(await exchangeCode("google", google, "c")).toBe("exchange");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("null")));
    expect(await exchangeCode("dropbox", dropbox, "c")).toBe("exchange");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await exchangeCode("dropbox", dropbox, "c")).toBe("exchange");
  });
});
