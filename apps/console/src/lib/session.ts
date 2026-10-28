import { actorFromIdentity } from "@aircheck/core";
import { auth } from "@clerk/nextjs/server";

export type HumanSession = { convexToken: () => Promise<string | null> };

/**
 * For route handlers: the signed-in real human (verified @radiomilwaukee.org, not demo), or null.
 * Reads the same session-token claims Convex's gate.ts reads, so both sides agree on who is real.
 */
export async function realHumanSession(): Promise<HumanSession | null> {
  const { userId, sessionClaims, getToken } = await auth();
  if (!userId || !sessionClaims) return null;
  const c = sessionClaims as Record<string, unknown>;
  const actor = actorFromIdentity({
    subject: userId,
    email: typeof c.email === "string" ? c.email : undefined,
    emailVerified: c.emailVerified === true || c.email_verified === true || c.email_verified === "true",
    role: typeof c.role === "string" ? c.role : undefined,
  });
  if (actor?.kind !== "human") return null;
  // Same choice as ConvexProviderWithClerk: the session token when it is minted for Convex, else the template.
  return { convexToken: () => getToken(c.aud === "convex" ? undefined : { template: "convex" }) };
}
