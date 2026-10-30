import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalUrl, TAVILY_SEARCH_URL, TavilyError, tavilySearch } from "../src/tavily.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("tavilySearch", () => {
  it("POSTs exactly the search body to /search with the bearer key and a 25-second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn(async () =>
      json(200, {
        results: [
          { title: "Album A", url: "https://example.org/a", content: "Out 2026-10-10", published_date: "2026-10-01", raw_content: "  Album A\n\n  is out\t2026-10-10  " },
          { title: "No date", url: "https://example.org/b", content: "c" },
        ],
      }),
    );
    const out = await tavilySearch({ apiKey: "tvly-test", fetch }, "artist a album release date");
    expect(TAVILY_SEARCH_URL).toBe("https://api.tavily.com/search");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tvly-test");
    expect(JSON.parse(String(init.body))).toEqual({
      query: "artist a album release date",
      // Oct 29 (Tarik): advanced depth (2 credits), up to 3 chunks per page, and each page's plain text (no extra credit).
      search_depth: "advanced",
      chunks_per_source: 3,
      max_results: 5,
      include_answer: false,
      include_raw_content: "text",
      include_images: false,
      // Tavily returns published_date only when asked (docs.tavily.com, checked via Context7 on Oct 29).
      include_published_date: true,
      // Oct 29 prefetch: the answer carries usage.credits (docs.tavily.com, checked via Context7).
      include_usage: true,
    });
    expect(timeout).toHaveBeenCalledWith(25_000);
    expect(out).toEqual({
      credits: 0, // no usage object in this answer
      results: [
        { url: "https://example.org/a", title: "Album A", content: "Out 2026-10-10", rawContent: "Album A is out 2026-10-10", publishedDate: "2026-10-01" },
        { url: "https://example.org/b", title: "No date", content: "c" },
      ],
    });
  });

  it("keeps at most 5 results and drops any without an http(s) URL", async () => {
    const results = [
      { title: "bad", url: "javascript:alert(1)", content: "x" },
      { title: "none", content: "x" },
      ...Array.from({ length: 7 }, (_, i) => ({ title: `t${i}`, url: `https://example.org/${i}`, content: "c" })),
    ];
    const out = await tavilySearch({ apiKey: "k", fetch: async () => json(200, { results }) }, "q");
    expect(out.results.map((r) => r.url)).toEqual([0, 1, 2, 3, 4].map((i) => `https://example.org/${i}`));
  });

  it("a non-200 answer becomes a plain error, never the key or the body", async () => {
    const call = tavilySearch({ apiKey: "tvly-secret", fetch: async () => json(432, { detail: "plan limit" }) }, "q");
    await expect(call).rejects.toThrow("Web search failed (HTTP 432).");
    await expect(call).rejects.not.toThrow(/secret|plan limit/);
  });

  it("a timeout or network failure becomes a plain error", async () => {
    const timedOut = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    await expect(tavilySearch({ apiKey: "k", fetch: timedOut }, "q")).rejects.toThrow("Web search timed out.");
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(tavilySearch({ apiKey: "k", fetch: down }, "q")).rejects.toThrow("Web search could not be reached.");
  });

  it("reads at most 2 MB of the answer (five pages of text); more is unreadable", async () => {
    const page = (n: number) => ({ title: "t", url: "https://example.org/a", content: "c", raw_content: "x".repeat(n) });
    const fits = JSON.stringify({ results: [page(1_500_000)] });
    expect((await tavilySearch({ apiKey: "k", fetch: async () => new Response(fits, { status: 200 }) }, "q")).results).toHaveLength(1);
    const big = JSON.stringify({ results: [page(2_100_000)] });
    await expect(tavilySearch({ apiKey: "k", fetch: async () => new Response(big, { status: 200 }) }, "q")).rejects.toThrow("Web search gave an unreadable answer.");
  });

  it("keeps at most 8,000 characters of each page's text, whitespace collapsed; no text means no rawContent", async () => {
    const results = [
      { title: "long", url: "https://example.org/a", content: "c", raw_content: `${"word \n\n ".repeat(3_000)}` },
      { title: "none", url: "https://example.org/b", content: "c", raw_content: null },
    ];
    const [a, b] = (await tavilySearch({ apiKey: "k", fetch: async () => json(200, { results }) }, "q")).results;
    expect(a!.rawContent).toHaveLength(8_000);
    expect(a!.rawContent).not.toMatch(/\s\s|\n/);
    expect(b).not.toHaveProperty("rawContent");
  });

  it("drops a result whose URL is over 2,048 characters", async () => {
    const results = [{ title: "long", url: `https://example.org/${"a".repeat(2_100)}`, content: "c" }, { title: "ok", url: "https://example.org/ok", content: "c" }];
    expect((await tavilySearch({ apiKey: "k", fetch: async () => json(200, { results }) }, "q")).results.map((r) => r.title)).toEqual(["ok"]);
  });

  it("an unreadable answer becomes a plain error", async () => {
    const bad = async () => new Response("<html>", { status: 200 });
    await expect(tavilySearch({ apiKey: "k", fetch: bad }, "q")).rejects.toThrow("Web search gave an unreadable answer.");
  });

  it("returns usage.credits, and takes a shorter timeout when asked (prefetch: 15 s)", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const out = await tavilySearch({ apiKey: "k", fetch: async () => json(200, { results: [], usage: { credits: 2 } }) }, "q", { timeoutMs: 15_000 });
    expect(out).toEqual({ results: [], credits: 2 });
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect((await tavilySearch({ apiKey: "k", fetch: async () => json(200, { results: [], usage: { credits: "lots" } }) }, "q")).credits).toBe(0);
  });

  it("marks 429, 5xx and timeouts retryable, and nothing else (Tavily's batch guidance)", async () => {
    const failWith = async (fetch: () => Promise<Response>) => {
      try {
        await tavilySearch({ apiKey: "k", fetch }, "q");
      } catch (e) {
        return e instanceof TavilyError ? e.retryable : "not a TavilyError";
      }
      return "no error";
    };
    expect(await failWith(async () => json(429, {}))).toBe(true);
    expect(await failWith(async () => json(503, {}))).toBe(true);
    expect(await failWith(async () => json(400, {}))).toBe(false);
    expect(await failWith(async () => json(401, {}))).toBe(false);
    expect(await failWith(async () => new Response("<html>", { status: 200 }))).toBe(false);
    expect(await failWith(async () => { throw new DOMException("t", "TimeoutError"); })).toBe(true);
    expect(await failWith(async () => { throw new TypeError("fetch failed"); })).toBe(false);
  });

  it("gives each result its canonical URL: no fragment, tracking parameters or trailing slash; other parameters kept", async () => {
    expect(canonicalUrl("https://Example.org/a/?utm_source=x&utm_medium=y#top")).toBe("https://example.org/a");
    expect(canonicalUrl("https://www.youtube.com/watch?v=abc123&si=share")).toBe("https://www.youtube.com/watch?v=abc123");
    expect(canonicalUrl("https://example.org/")).toBe("https://example.org/");
    expect(canonicalUrl("https://example.org/a?fbclid=1&gclid=2")).toBe("https://example.org/a");
    const results = [{ title: "a", url: "https://example.org/a/?utm_source=t", content: "c" }];
    expect((await tavilySearch({ apiKey: "k", fetch: async () => json(200, { results }) }, "q")).results[0]!.url).toBe("https://example.org/a");
  });

  it("is search-only: the module never names Tavily's extract endpoint", () => {
    expect(readFileSync(new URL("../src/tavily.ts", import.meta.url), "utf8")).not.toMatch(/extract/i);
  });
});
