/**
 * The one Tavily client (Plan 7). Search only: POST /search, never any other Tavily endpoint. The key lives in the
 * bridge's environment on the VM; the agent never holds it (Hard Rule 2's spirit, decision 006).
 */
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 5;
const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 262_144; // five basic results are a few KB; more is not an answer we asked for
const MAX_URL = 2_048;

export interface TavilyResult {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isWebUrl = (s: string) => s.length <= MAX_URL && URL.canParse(s) && ["http:", "https:"].includes(new URL(s).protocol);

/** The body as text, or null past `max` bytes (the console's readCapped, apps/console/src/app/api/agentmail/inbound/route.ts). */
async function readCapped(res: Response, max: number): Promise<string | null> {
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

/** Throws a plain-sentence Error on a non-200, a timeout or an unreadable answer; never echoes the key or the body. */
export async function tavilySearch(opts: { apiKey: string; fetch?: typeof fetch }, query: string): Promise<TavilyResult[]> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: MAX_RESULTS,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        // Without this Tavily leaves out published_date (docs.tavily.com, checked via Context7, Oct 29).
        include_published_date: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(e instanceof Error && e.name === "TimeoutError" ? "Web search timed out." : "Web search could not be reached.");
  }
  if (res.status !== 200) throw new Error(`Web search failed (HTTP ${res.status}).`);
  let data: { results?: unknown } | null = null;
  try {
    const raw = await readCapped(res, MAX_BODY_BYTES);
    data = raw === null ? null : (JSON.parse(raw) as { results?: unknown } | null);
  } catch {
    data = null; // a body that breaks mid-read or is not JSON
  }
  if (!data || !Array.isArray(data.results)) throw new Error("Web search gave an unreadable answer.");
  return data.results
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && isWebUrl(str((r as { url?: unknown }).url)))
    .slice(0, MAX_RESULTS)
    .map((r) => ({ url: str(r.url), title: str(r.title), content: str(r.content), ...(str(r.published_date) && { publishedDate: str(r.published_date) }) }));
}
