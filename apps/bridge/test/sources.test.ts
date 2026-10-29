import { LIMITS, sourceSays, type ResolvedSource } from "@aircheck/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { annotateCrateResult, createSourceLedger, musicBrainzUrl, SOURCE_TEXT_MAX, urlsIn } from "../src/sources.js";

const src = (url: string, text = "t", title = "T"): ResolvedSource => ({ url, host: new URL(url).hostname, title, via: "tavily", text });
const ID = /^S[0-9a-z]{5}$/;

afterEach(() => vi.useRealTimers());

describe("createSourceLedger", () => {
  it("issues S + 5 base36 ids that get() resolves", () => {
    const ledger = createSourceLedger();
    const id = ledger.add(src("https://example.org/a", "Out on 2026-10-10"));
    expect(id).toMatch(ID);
    expect(ledger.get(id)).toEqual(src("https://example.org/a", "Out on 2026-10-10"));
    expect(ledger.get("S9zzzz")).toBeUndefined();
  });

  it("gives the same URL the same id, and adds new text a later result brings (preflight T2)", () => {
    const ledger = createSourceLedger();
    const crate = ledger.add({ ...src("https://musicbrainz.org/release/x", '{"title":"Album A"}'), via: "crate:musicbrainz_search_release" });
    const tavily = ledger.add(src("https://musicbrainz.org/release/x", "Album A, released 2026-10-10"));
    expect(tavily).toBe(crate);
    const text = ledger.get(crate)!.text;
    expect(sourceSays(text, "release-date", "2026-10-10")).toBe(true);
    expect(text).toContain("Album A");
    ledger.add(src("https://musicbrainz.org/release/x", "Album A, released 2026-10-10"));
    expect(ledger.get(crate)!.text).toBe(text); // already there: not added twice
  });

  it("caps text at 2,000 characters, and a repeat URL's new text still fits", () => {
    expect(SOURCE_TEXT_MAX).toBe(LIMITS.sourceText);
    const ledger = createSourceLedger();
    const id = ledger.add(src("https://example.org/a", "a".repeat(5_000)));
    expect(ledger.get(id)!.text).toHaveLength(2_000);
    ledger.add(src("https://example.org/a", "released 2026-10-10"));
    const text = ledger.get(id)!.text;
    expect(text.length).toBeLessThanOrEqual(2_000);
    expect(text.endsWith("released 2026-10-10")).toBe(true);
  });

  it("forgets entries after the TTL: an expired id is unknown", () => {
    vi.useFakeTimers();
    const ledger = createSourceLedger({ ttlMs: 1_000 });
    const id = ledger.add(src("https://example.org/a"));
    vi.advanceTimersByTime(999);
    expect(ledger.get(id)).toBeDefined();
    vi.advanceTimersByTime(2);
    expect(ledger.get(id)).toBeUndefined();
    expect(ledger.add(src("https://example.org/a"))).not.toBe(id); // a fresh id, never the old one
  });

  it("keeps 24 hours by default", () => {
    vi.useFakeTimers();
    const ledger = createSourceLedger();
    const id = ledger.add(src("https://example.org/a"));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
    expect(ledger.get(id)).toBeDefined();
    vi.advanceTimersByTime(2);
    expect(ledger.get(id)).toBeUndefined();
  });

  it("drops the oldest first when full", () => {
    const ledger = createSourceLedger({ max: 2 });
    const a = ledger.add(src("https://example.org/a"));
    const b = ledger.add(src("https://example.org/b"));
    const c = ledger.add(src("https://example.org/c"));
    expect(ledger.get(a)).toBeUndefined();
    expect(ledger.get(b)).toBeDefined();
    expect(ledger.get(c)).toBeDefined();
  });
});

describe("urlsIn", () => {
  it("finds http(s) URLs once each, without trailing punctuation", () => {
    const text = 'See https://example.org/a. Also (https://en.wikipedia.org/wiki/Foo_(band)), "https://example.org/a" and ftp://x.org/y, http://b.example.com/p?q=1;';
    expect(urlsIn(text)).toEqual(["https://example.org/a", "https://en.wikipedia.org/wiki/Foo_(band)", "http://b.example.com/p?q=1"]);
  });
  it("is linear on a long hostile run", () => {
    const hostile = `https://x.org/${".".repeat(200_000)}`;
    const t = performance.now();
    urlsIn(hostile);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("annotateCrateResult", () => {
  const text = (r: CallToolResult) => (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  const idsIn = (s: string) => [...s.matchAll(/\[(S[0-9a-z]{5})\]/g)].map((m) => m[1]!);

  it("a result with two URLs ends with two source ids that resolve to them and that text", () => {
    const ledger = createSourceLedger();
    const body = "Artist A is a band. https://en.wikipedia.org/wiki/Artist_A and https://artista.bandcamp.com/album/home";
    const out = annotateCrateResult(ledger, "wikipedia_summary", { content: [{ type: "text", text: body }] });
    const all = text(out);
    expect(all.startsWith(body)).toBe(true);
    expect(all).toMatch(/\nSources:\n\[S[0-9a-z]{5}\] en\.wikipedia\.org\n\[S[0-9a-z]{5}\] artista\.bandcamp\.com$/);
    const ids = idsIn(all.slice(body.length));
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => ledger.get(id)!.url)).toEqual(["https://en.wikipedia.org/wiki/Artist_A", "https://artista.bandcamp.com/album/home"]);
    for (const id of ids) expect(ledger.get(id)).toMatchObject({ text: body, via: "crate:wikipedia_summary" });
  });

  it("builds a MusicBrainz URL from each listed id, with that item's own text and name", () => {
    const ledger = createSourceLedger();
    const a = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";
    const b = "0383dadf-2a4e-4d10-a46a-e9e041da8eb3";
    const body = JSON.stringify({ count: 2, releases: [{ id: a, title: "Home", date: "2026-10-10" }, { id: b, title: "Away", date: "2025-01-01" }] });
    const all = text(annotateCrateResult(ledger, "musicbrainz_search_release", { content: [{ type: "text", text: body }] }));
    const ids = idsIn(all.slice(body.length));
    expect(ids.map((id) => ledger.get(id)!.url)).toEqual([musicBrainzUrl("release", a), musicBrainzUrl("release", b)]);
    expect(musicBrainzUrl("release", a)).toBe(`https://musicbrainz.org/release/${a}`);
    expect(ledger.get(ids[0]!)).toMatchObject({ title: "Home", host: "musicbrainz.org" });
    expect(sourceSays(ledger.get(ids[0]!)!.text, "release-date", "2026-10-10")).toBe(true);
    expect(sourceSays(ledger.get(ids[1]!)!.text, "release-date", "2026-10-10")).toBe(false);
    expect(all).toContain(`[${ids[0]}] Home · musicbrainz.org`);
  });

  it("a lookup with one top-level id is one source, and release groups get their own path", () => {
    const ledger = createSourceLedger();
    const id = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";
    const body = JSON.stringify({ id, title: "Home", tags: [{ name: "jazz" }] });
    const ids = idsIn(text(annotateCrateResult(ledger, "musicbrainz_get_release_group", { content: [{ type: "text", text: body }] })));
    expect(ids.map((i) => ledger.get(i)!.url)).toEqual([`https://musicbrainz.org/release-group/${id}`]);
  });

  it("a result with no URL and no buildable id gets no source ids", () => {
    const ledger = createSourceLedger();
    const plain: CallToolResult = { content: [{ type: "text", text: "Artist A: 3 releases, latest 2026." }] };
    expect(annotateCrateResult(ledger, "itunes_search", plain)).toEqual(plain);
    const notMb: CallToolResult = { content: [{ type: "text", text: JSON.stringify([{ id: "5b11f4ce-a62d-471e-81fc-a69a8278c7da" }]) }] };
    expect(annotateCrateResult(ledger, "itunes_search", notMb)).toEqual(notMb);
  });

  it("leaves an error result alone", () => {
    const ledger = createSourceLedger();
    const err: CallToolResult = { content: [{ type: "text", text: "failed https://example.org/x" }], isError: true };
    expect(annotateCrateResult(ledger, "wikipedia_summary", err)).toEqual(err);
  });
});
