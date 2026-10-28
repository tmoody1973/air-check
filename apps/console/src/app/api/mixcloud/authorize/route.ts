import { authorizeUrl, errorLocation, logStep, mixcloudConfig, newState, sameOrigin, stateCookie } from "@/lib/mixcloudOAuth";
import { realHumanSession } from "@/lib/session";

// Starts Connect Mixcloud from the Settings form. POST only, same origin only: a cross-site link or page must not be
// able to plant a state cookie (login CSRF). The state cookie then guards the callback.
const see = (location: string, extra: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", ...extra } });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  if (!(await realHumanSession())) return new Response("Forbidden", { status: 403 });
  const cfg = mixcloudConfig();
  logStep("authorize", !!cfg);
  // Relative Location for our own pages: behind Caddy, request.url is the internal origin.
  if (!cfg) return see(errorLocation("config"));
  const state = newState();
  return see(authorizeUrl(cfg, state), { "Set-Cookie": stateCookie(state) });
}
