import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time check of an `Authorization: Bearer <token>` header. Hashing first hides the length too. */
export function bearerOk(header: string | undefined, expected: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m || !expected) return false;
  return timingSafeEqual(digest(m[1]!), digest(expected));
}
