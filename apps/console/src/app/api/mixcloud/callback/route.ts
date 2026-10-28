import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import {
  CLEAR_STATE_COOKIE, STATE_COOKIE, type ErrorReason, errorLocation, exchangeCode, fetchAccount, logStep,
  mixcloudConfig, readCookie, statesMatch, tokenFilePath, writeTokenFile,
} from "@/lib/mixcloudOAuth";
import { realHumanSession } from "@/lib/session";

// Mixcloud sends the browser back here with ?code=…. Every response clears the one-time state cookie.
const reply = (status: number, location?: string) =>
  new Response(status === 403 ? "Forbidden" : null, {
    status,
    headers: { "Set-Cookie": CLEAR_STATE_COOKIE, "Cache-Control": "no-store", ...(location ? { Location: location } : {}) },
  });

const fail = (step: ErrorReason) => {
  logStep(step, false);
  return reply(302, errorLocation(step));
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const session = await realHumanSession();
  if (!session) return reply(403);

  // The cookie proves this browser started the flow in the last 10 minutes. Mixcloud does not document echoing
  // `state`, so it is compared (in constant time) only when it comes back.
  const expected = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  const echoed = params.get("state");
  // TODO(R21): require state once Mixcloud is confirmed to echo it
  if (!expected || (echoed !== null && !statesMatch(expected, echoed))) return fail("state");

  const code = params.get("code");
  if (params.has("error") || !code) return fail("denied");
  const cfg = mixcloudConfig();
  if (!cfg) return fail("config");

  const accessToken = await exchangeCode(cfg, code);
  if (!accessToken) return fail("exchange");
  logStep("exchange", true);
  const account = await fetchAccount(accessToken);
  if (!account) return fail("profile");
  logStep("profile", true);

  try {
    await writeTokenFile(tokenFilePath(), { access_token: accessToken, account, connectedAt: Date.now() });
  } catch {
    return fail("write");
  }
  logStep("write", true);

  try {
    const token = await session.convexToken();
    if (!token) throw new Error("no Convex token");
    await fetchMutation(api.mixcloud.connected, { account }, { token });
  } catch {
    return fail("status");
  }
  logStep("status", true);
  return reply(302, "/settings?mixcloud=connected");
}
