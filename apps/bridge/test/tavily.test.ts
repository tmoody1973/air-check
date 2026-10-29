import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TAVILY_SEARCH_URL, tavilySearch } from "../src/tavily.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("tavilySearch", () => {
  it("POSTs exactly the search body to /search with the bearer key and a 15-second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn(async () =>
      json(200, {
        results: [
          { title: "Album A", url: "https://example.org/a", content: "Out 2026-10-10", published_date: "2026-10-01", raw_content: "x" },
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
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      // Tavily returns published_date only when asked (docs.tavily.com, checked via Context7 on Oct 29).
      include_published_date: true,
    });
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(out).toEqual([
      { url: "https://example.org/a", title: "Album A", content: "Out 2026-10-10", publishedDate: "2026-10-01" },
      { url: "https://example.org/b", title: "No date", content: "c" },
    ]);
  });

  it("keeps at most 5 results and drops any without an http(s) URL", async () => {
    const results = [
      { title: "bad", url: "javascript:alert(1)", content: "x" },
      { title: "none", content: "x" },
      ...Array.from({ length: 7 }, (_, i) => ({ title: `t${i}`, url: `https://example.org/${i}`, content: "c" })),
    ];
    const out = await tavilySearch({ apiKey: "k", fetch: async () => json(200, { results }) }, "q");
    expect(out.map((r) => r.url)).toEqual([0, 1, 2, 3, 4].map((i) => `https://example.org/${i}`));
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

  it("an unreadable answer becomes a plain error", async () => {
    const bad = async () => new Response("<html>", { status: 200 });
    await expect(tavilySearch({ apiKey: "k", fetch: bad }, "q")).rejects.toThrow("Web search gave an unreadable answer.");
  });

  it("is search-only: the module never names Tavily's extract endpoint", () => {
    expect(readFileSync(new URL("../src/tavily.ts", import.meta.url), "utf8")).not.toMatch(/extract/i);
  });
});
