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

/** Constant-time check of a bare token against a secret that must be set and at least MIN_TOKEN_LENGTH long. */
export function sameToken(given: string, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return false;
  return sameBytes(given, expected);
}

export function tokenMatches(header: string | null, expected: string | undefined): boolean {
  return !!header?.startsWith("Bearer ") && sameToken(header.slice("Bearer ".length), expected);
}

/** Which workspace a Bearer header authorises: the real-token wins a tie; null means neither matched. */
export function workspaceForToken(
  header: string | null,
  tokens: { real: string | undefined; demo: string | undefined },
): "real" | "demo" | null {
  if (tokens.real && tokens.real === tokens.demo) return null; // same secret for both: ambiguous
  const real = tokenMatches(header, tokens.real); // both compares always run
  const demo = tokenMatches(header, tokens.demo);
  return real ? "real" : demo ? "demo" : null;
}

export const MAX_BODY_BYTES = 131_072; // same cap as the bridge

/** Reads the body as text, giving up (null) as soon as it passes the cap, before any JSON parsing. */
export async function readCapped(req: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
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
