import type { AgentPackageInput, ClaimKind, ResolvedSource } from "@aircheck/core";
import { ConvexError } from "convex/values";

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

/**
 * The ingest service's check (Plan 6), here beside sameToken so ingest.ts and radar.ts share it without importing each
 * other's modules. INGEST_TOKEN in constant time; fails closed when unset or shorter than 32 characters. A token equal
 * to another service's or the agent's would let one act as the other, so that refuses everything too (M7).
 */
export function requireIngest(token: string): void {
  const { INGEST_TOKEN, MEDIA_TOKEN, PUBLISHER_TOKEN, RELAY_TOKEN, AGENT_SUBMIT_TOKEN, DEMO_AGENT_SUBMIT_TOKEN, INBOX_TOKEN } = process.env;
  const shared = [MEDIA_TOKEN, PUBLISHER_TOKEN, RELAY_TOKEN, AGENT_SUBMIT_TOKEN, DEMO_AGENT_SUBMIT_TOKEN, INBOX_TOKEN].includes(INGEST_TOKEN);
  if (shared || !sameToken(token, INGEST_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

export function tokenMatches(header: string | null, expected: string | undefined): boolean {
  return !!header?.startsWith("Bearer ") && sameToken(header.slice("Bearer ".length), expected);
}

/**
 * Which workspace a Bearer header authorises: the real-token wins a tie; null means neither matched. R11: an agent token
 * equal to INGEST_TOKEN or INBOX_TOKEN is treated as unset, so neither service's secret ever opens an agent route.
 */
export function workspaceForToken(
  header: string | null,
  tokens: { real: string | undefined; demo: string | undefined },
  ingest = process.env.INGEST_TOKEN,
): "real" | "demo" | null {
  if (tokens.real && tokens.real === tokens.demo) return null; // same secret for both: ambiguous
  const inbox = process.env.INBOX_TOKEN;
  const usable = (t: string | undefined) => (t && (t === ingest || t === inbox) ? undefined : t);
  const real = tokenMatches(header, usable(tokens.real)); // both compares always run
  const demo = tokenMatches(header, usable(tokens.demo));
  return real ? "real" : demo ? "demo" : null;
}

export const MAX_BODY_BYTES = 131_072; // same cap as the bridge
/**
 * POST /agent/research only: a block carries its cited sources' text (LIMITS.sourcesPerBlock × LIMITS.sourceText), so
 * 40 × 8,000 characters at JSON's worst 6 bytes each, plus URLs, is about 2 MB. Convex takes 16 MiB of arguments.
 */
export const RESEARCH_BODY_BYTES = 4 * 1024 * 1024;

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

const STRINGS = ["showDate", "description", "hour1Id", "hour2Id"] as const;
const LISTS = ["leads", "tags"] as const;

/** Copies only the named fields; anything else the caller sends (status, workspace...) is dropped. */
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
  // R9: any tracklist the agent sends is ignored; packages.submit uses the draft request's.
  out.tracklistText = "";
  // Optional; its shape is checked (with plain messages) by buildPackageDraft.
  if (b.descriptionSources !== undefined) (out as Record<string, unknown>).descriptionSources = b.descriptionSources;
  return out as unknown as AgentPackageInput;
}

/** The server's private terms (AIRCHECK_PRIVATE_TERMS, comma-separated): never allowed in a public description. */
export const privateTerms = () =>
  (process.env.AIRCHECK_PRIVATE_TERMS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export type AgentRevision = { packageId: string; description: string; descriptionSources?: unknown };

/** The agent's revision: the package id and the new description (with optional sources); anything else is dropped. */
export function pickRevision(body: unknown): AgentRevision | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.packageId !== "string" || typeof b.description !== "string") return null;
  // Optional; its shape is checked (with plain messages) by checkDescriptionChange.
  return { packageId: b.packageId, description: b.description, ...(b.descriptionSources !== undefined && { descriptionSources: b.descriptionSources }) };
}

// Plan 7: the research route's body. Known fields only, at every level (Review Focus 4): an artist, title or URL the agent
// adds is dropped here, so a block can only carry the agent's own words and the cited sources' text.
type ResearchClaim = { kind: ClaimKind; text: string; value?: string; sources: { id: string; says?: string; primary?: boolean }[] };
export type ResearchSource = ResolvedSource & { id: string };
export type ResearchSubmit = {
  job: string;
  key: string;
  claims?: ResearchClaim[];
  intro?: string;
  threads?: ResearchClaim[];
  angle?: string;
  note?: string;
  replacement?: string;
  private?: { reason?: string };
  sources: ResearchSource[];
};
// A Record keyed by core's type, so a kind added or removed in core fails the typecheck here.
const CLAIM_KINDS: Record<ClaimKind, true> = {
  release: true, "release-date": true, label: true, credit: true, "track-number": true, length: true, bio: true, detail: true, thread: true, connection: true,
  chart: true, story: true, song: true, samples: true, video: true, "fun-fact": true,
};
const MAX_ID = 40;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const optStr = (x: unknown) => x === undefined || typeof x === "string";
const shortStr = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= MAX_ID;

function pickClaim(c: unknown): ResearchClaim | null {
  if (!isObj(c) || typeof c.kind !== "string" || !Object.hasOwn(CLAIM_KINDS, c.kind) || typeof c.text !== "string" || !optStr(c.value) || !Array.isArray(c.sources)) return null;
  const sources: ResearchClaim["sources"] = [];
  for (const s of c.sources) {
    if (!isObj(s) || !shortStr(s.id) || !optStr(s.says) || (s.primary !== undefined && typeof s.primary !== "boolean")) return null;
    sources.push({ id: s.id, ...(s.says !== undefined && { says: s.says as string }), ...(s.primary !== undefined && { primary: s.primary as boolean }) });
  }
  return { kind: c.kind as ClaimKind, text: c.text, ...(c.value !== undefined && { value: c.value as string }), sources };
}

function pickSource(id: string, s: unknown): ResearchSource | null {
  if (!isObj(s)) return null;
  const { url, host, title, via, text } = s;
  if (![url, host, title, via, text].every((x) => typeof x === "string")) return null;
  return { id, url: url as string, host: host as string, title: title as string, via: via as string, text: text as string };
}

/** The research block the agent posts, or plain problems. Only the cited ids' sources are kept. */
export function pickResearch(body: unknown): { input: ResearchSubmit } | { problems: string[] } {
  if (!isObj(body) || !shortStr(body.job) || !shortStr(body.key)) return { problems: ["body must have job and key, the ids from your research job"] };
  const problems: string[] = [];
  const input: ResearchSubmit = { job: body.job, key: body.key, sources: [] };
  for (const field of ["claims", "threads"] as const) {
    const list = body[field];
    if (list === undefined) continue;
    const picked = Array.isArray(list) ? list.map(pickClaim) : [null];
    if (picked.some((c) => c === null)) problems.push(`${field} must be a list of { kind, text, value?, sources: [{ id, says?, primary? }] }`);
    else input[field] = picked as ResearchClaim[];
  }
  for (const field of ["intro", "angle", "note", "replacement"] as const) {
    if (!optStr(body[field])) problems.push(`${field} must be text`);
    else if (body[field] !== undefined) input[field] = body[field] as string;
  }
  if (body.private !== undefined) {
    if (!isObj(body.private) || !optStr(body.private.reason)) problems.push("private must be { reason }");
    else input.private = body.private.reason === undefined ? {} : { reason: body.private.reason as string };
  }
  const cited = new Set([...(input.claims ?? []), ...(input.threads ?? [])].flatMap((c) => c.sources.map((s) => s.id)));
  const given = isObj(body.sources) ? body.sources : {};
  for (const id of cited) {
    if (!Object.hasOwn(given, id)) continue; // reported by submitEntry, which names the id
    const s = pickSource(id, given[id]);
    if (s) input.sources.push(s);
    else problems.push("sources must be the cited ids' sources, as the bridge sends them");
  }
  return problems.length ? { problems: [...new Set(problems)] } : { input };
}

/** POST /agent/search-usage: `{ query }` (web) or `{ query, source: "apple_music" }`; anything else is null. */
export function pickSearchUsage(body: unknown): { query: string; source?: "apple_music" } | null {
  if (!isObj(body) || typeof body.query !== "string" || body.query.length > 1_000) return null;
  if (body.source === undefined || body.source === "web") return { query: body.query };
  return body.source === "apple_music" ? { query: body.query, source: "apple_music" } : null;
}
