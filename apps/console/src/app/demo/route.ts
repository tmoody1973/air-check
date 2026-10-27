import { clerkClient } from "@clerk/nextjs/server";
import { createRateLimiter } from "@/lib/rate-limit";

// Hard Rule 9: this is only a Clerk session for the demo user. It grants nothing more.
const allow = createRateLimiter(10, 60_000);

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(ip)) return new Response("Too many requests. Try again in a minute.", { status: 429 });

  const userId = process.env.AIRCHECK_DEMO_USER_ID;
  if (!userId) return new Response("The demo workspace is not set up on this server.", { status: 503 });

  const client = await clerkClient();
  const { token } = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 });
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("__clerk_ticket", token);
  url.searchParams.set("redirect_url", "/today");
  return Response.redirect(url, 302);
}
