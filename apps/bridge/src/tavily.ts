/**
 * The one Tavily client (Plan 7). Search only: POST /search, never any other Tavily endpoint. The key lives in the
 * bridge's environment on the VM; the agent never holds it (Hard Rule 2's spirit, decision 006).
 */
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 5;
const TIMEOUT_MS = 25_000; // advanced depth plus each page's text takes longer than a basic search
const MAX_BODY_BYTES = 2_097_152; // five pages of raw text fit; more is not an answer we asked for
const MAX_URL = 2_048;
/** core's LIMITS.sourceText: the most of a page's text the ledger can keep, so no more is held here. */
const MAX_PAGE_TEXT = 8_000;

export interface TavilyResult {
  url: string;
  title: string;
  /** Advanced depth: up to three relevant chunks of the page, joined by Tavily. */
  content: string;
  /** The page's cleaned plain text, whitespace collapsed, at most 8,000 characters. Untrusted data. */
  rawContent?: string;
  publishedDate?: string;
}

/** What one search returned, and the Tavily credits it cost (usage.credits; 0 when Tavily sends none). */
export interface TavilyAnswer {
  results: TavilyResult[];
  credits: number;
}

/** A failed search. `retryable`: a 429, a 5xx or a timeout, the only failures Tavily's batch guidance retries. */
export class TavilyError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

// ponytail: the common trackers only; add one when a real result shows it splitting a page in two.
const TRACKING = /^(?:utm_.*|fbclid|gclid|igshid|mc_cid|mc_eid|si)$/i;
/**
 * One spelling per page, so the ledger keeps one source for it: no fragment, no tracking parameters, no trailing slash.
 * Other parameters stay (YouTube's ?v= is the video), unlike Tavily's "drop the query string" advice.
 */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isWebUrl = (s: string) => s.length <= MAX_URL && URL.canParse(s) && ["http:", "https:"].includes(new URL(s).protocol);

/** The body as text, or null past `max` bytes (the console's readCapped, apps/console/src/app/api/agentmail/inbound/route.ts). */
export async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Throws a plain-sentence TavilyError on a non-200, a timeout or an unreadable answer; never echoes the key or the body. */
export async function tavilySearch(
  opts: { apiKey: string; fetch?: typeof fetch },
  query: string,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<TavilyAnswer> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        query,
        // Oct 29 (Tarik, after comparing with his Perplexity notes): advanced depth costs 2 credits a search (basic 1);
        // chunks_per_source works only with it. "text" adds each page's plain text at no extra credit.
        search_depth: "advanced",
        chunks_per_source: 3,
        max_results: MAX_RESULTS,
        include_answer: false,
        include_raw_content: "text",
        include_images: false,
        // Without this Tavily leaves out published_date (docs.tavily.com, checked via Context7, Oct 29).
        include_published_date: true,
        // The answer's usage.credits, summed per prefetch and shown in Settings (docs.tavily.com, via Context7, Oct 29).
        include_usage: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    throw new TavilyError(timedOut ? "Web search timed out." : "Web search could not be reached.", timedOut);
  }
  if (res.status !== 200) throw new TavilyError(`Web search failed (HTTP ${res.status}).`, res.status === 429 || res.status >= 500);
  type Answer = { results?: unknown; usage?: { credits?: unknown } } | null;
  let data: Answer = null;
  try {
    const raw = await readCapped(res, MAX_BODY_BYTES);
    data = raw === null ? null : (JSON.parse(raw) as Answer);
  } catch {
    data = null; // a body that breaks mid-read or is not JSON
  }
  if (!data || !Array.isArray(data.results)) throw new TavilyError("Web search gave an unreadable answer.", false);
  const credits = typeof data.usage?.credits === "number" && data.usage.credits >= 0 ? data.usage.credits : 0;
  const results = data.results
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && isWebUrl(str((r as { url?: unknown }).url)))
    .slice(0, MAX_RESULTS)
    .map((r) => {
      const page = str(r.raw_content).replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT);
      return {
        url: canonicalUrl(str(r.url)),
        title: str(r.title),
        content: str(r.content),
        ...(page && { rawContent: page }),
        ...(str(r.published_date) && { publishedDate: str(r.published_date) }),
      };
    });
  return { results, credits };
}
