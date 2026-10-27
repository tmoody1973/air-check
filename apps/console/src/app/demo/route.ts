import { clerkClient } from "@clerk/nextjs/server";
import { clientIp } from "@/lib/client-ip";
import { createRateLimiter } from "@/lib/rate-limit";

// Hard Rule 9: this is only a Clerk session for the demo user. It grants nothing more.
const allow = createRateLimiter(10, 60_000);
const UNAVAILABLE = "The demo is unavailable right now.";

export async function GET(request: Request) {
  if (!allow(clientIp(request.headers))) {
    return new Response("Too many requests. Try again in a minute.", { status: 429 });
  }

  const userId = process.env.AIRCHECK_DEMO_USER_ID;
  if (!userId) return new Response(UNAVAILABLE, { status: 503 });

  let token: string;
  try {
    const client = await clerkClient();
    ({ token } = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 }));
  } catch (err) {
    // Log the failure, never the token.
    console.error("demo sign-in token failed:", err instanceof Error ? err.message : "unknown error");
    return new Response(UNAVAILABLE, { status: 503 });
  }

  // Relative Location: behind Caddy, request.url is the internal origin.
  return new Response(null, {
    status: 302,
    headers: { Location: `/sign-in?__clerk_ticket=${encodeURIComponent(token)}&redirect_url=/today` },
  });
}
