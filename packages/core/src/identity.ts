import { type Actor, APPROVER_DOMAIN } from "./package/approval";

/** Claims read from a Clerk session. Convex maps `ctx.auth.getUserIdentity()` into this. */
export interface IdentityClaims {
  subject: string;
  email?: string;
  emailVerified?: boolean;
  role?: string;
}

/**
 * Maps a signed-in identity to an Actor. Agents never hold a Clerk identity,
 * so this never returns `{ kind: "agent" }`.
 */
export function actorFromIdentity(id: IdentityClaims | null): Actor | null {
  if (!id) return null;
  if (id.role === "demo") return { kind: "demo", userId: id.subject };
  const email = id.email;
  if (id.emailVerified && email && email.toLowerCase().endsWith(APPROVER_DOMAIN)) {
    return { kind: "human", userId: id.subject, email };
  }
  return null;
}
