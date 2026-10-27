import type { AgentPackageInput } from "@aircheck/core";

export const MIN_TOKEN_LENGTH = 32;

/** Constant-time compare of equal-length byte strings; the length check leaks only the (public) length. */
function sameBytes(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export function tokenMatches(header: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_TOKEN_LENGTH || !header?.startsWith("Bearer ")) return false;
  return sameBytes(header.slice("Bearer ".length), expected);
}

const STRINGS = ["showDate", "tracklistText", "description", "hour1Id", "hour2Id"] as const;
const LISTS = ["leads", "tags"] as const;

/** Copies only the seven named fields; anything else the caller sends (status, workspace...) is dropped. */
export function pickInput(body: unknown): AgentPackageInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};
  for (const k of STRINGS) {
    if (typeof b[k] !== "string") return null;
    out[k] = b[k] as string;
  }
  for (const k of LISTS) {
    const list = b[k];
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) return null;
    out[k] = [...(list as string[])];
  }
  return out as unknown as AgentPackageInput;
}
