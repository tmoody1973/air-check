import { authorizeUrl, errorLocation, logStep, mixcloudConfig, newState, stateCookie } from "@/lib/mixcloudOAuth";
import { realHumanSession } from "@/lib/session";

// Starts Connect Mixcloud. Signed-in real human only; the state cookie is our CSRF guard for the callback.
export async function GET() {
  if (!(await realHumanSession())) return new Response("Forbidden", { status: 403 });
  const cfg = mixcloudConfig();
  logStep("authorize", !!cfg);
  // Relative Location for our own pages: behind Caddy, request.url is the internal origin.
  if (!cfg) return new Response(null, { status: 302, headers: { Location: errorLocation("config") } });
  const state = newState();
  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl(cfg, state), "Set-Cookie": stateCookie(state), "Cache-Control": "no-store" },
  });
}
