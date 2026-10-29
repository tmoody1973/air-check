import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import {
  type IngestErrorReason, type Provider, authorizeUrl, clearStateCookie, errorLocation, exchangeCode, ingestConfig, logStep,
  stateCookie, stateCookieName, tokenFilePath,
} from "./ingestOAuth";
import { newState, readCookie, removeTokenFile, sameOrigin, statesMatch, writeTokenFile } from "./oauth";
import { realHumanSession } from "./session";

// The three route handlers behind Connect Google Drive and Connect Dropbox, one set per provider (the route files
// only bind the provider). Same shape as the Mixcloud routes. Relative Location for our own pages: behind Caddy,
// request.url is the internal origin.

const forbidden = () => new Response("Forbidden", { status: 403 });
const see = (location: string, extra: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", ...extra } });

/** POST only, same origin only: a cross-site link or page must not be able to plant a state cookie (login CSRF). */
export const authorizeHandler = (p: Provider) => async (request: Request) => {
  if (!sameOrigin(request)) return forbidden();
  if (!(await realHumanSession())) return forbidden();
  const cfg = ingestConfig(p);
  logStep(p, "authorize", !!cfg);
  if (!cfg) return see(errorLocation(p, "config"));
  const state = newState();
  return see(authorizeUrl(p, cfg, state), { "Set-Cookie": stateCookie(p, state) });
};

/** The provider sends the browser back with ?code=…&state=…. Every response clears the one-time state cookie. */
export const callbackHandler = (p: Provider) => async (request: Request) => {
  const reply = (status: number, location?: string) =>
    new Response(status === 403 ? "Forbidden" : null, {
      status,
      headers: { "Set-Cookie": clearStateCookie(p), "Cache-Control": "no-store", ...(location ? { Location: location } : {}) },
    });
  const fail = (step: IngestErrorReason) => {
    logStep(p, step, false);
    return reply(302, errorLocation(p, step));
  };

  const params = new URL(request.url).searchParams;
  const session = await realHumanSession();
  if (!session) return reply(403);
  // Google and Dropbox both echo `state` (standard OAuth 2), so unlike Mixcloud it is always required.
  if (!statesMatch(readCookie(request.headers.get("cookie"), stateCookieName(p)), params.get("state") ?? undefined)) return fail("state");

  const code = params.get("code");
  if (params.has("error") || !code) return fail("denied");
  const cfg = ingestConfig(p);
  if (!cfg) return fail("config");

  const got = await exchangeCode(p, cfg, code);
  if (typeof got === "string") return fail(got);
  logStep(p, "exchange", true);

  try {
    await writeTokenFile(tokenFilePath(p), { refresh_token: got.refreshToken, account: got.account, connectedAt: Date.now() });
  } catch {
    return fail("write");
  }
  logStep(p, "write", true);

  try {
    const token = await session.convexToken();
    if (!token) throw new Error("no Convex token");
    await fetchMutation(api.episodes.sourceConnected, { source: p, account: got.account }, { token });
  } catch {
    return fail("status");
  }
  logStep(p, "status", true);
  return reply(302, `/settings?${p}=connected`);
};

/** The Settings card's Disconnect form. Cookie-authenticated, so a cross-site POST (no or foreign Origin) is refused. */
export const disconnectHandler = (p: Provider) => async (request: Request) => {
  if (!sameOrigin(request)) return forbidden();
  const session = await realHumanSession();
  if (!session) return forbidden();
  const back = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

  try {
    await removeTokenFile(tokenFilePath(p));
  } catch {
    logStep(p, "remove", false);
    return back(errorLocation(p, "write"));
  }
  try {
    const token = await session.convexToken();
    if (!token) throw new Error("no Convex token");
    await fetchMutation(api.episodes.sourceDisconnected, { source: p }, { token });
  } catch {
    logStep(p, "disconnect", false);
    return back(errorLocation(p, "status"));
  }
  logStep(p, "disconnect", true);
  return back(`/settings?${p}=disconnected`);
};
