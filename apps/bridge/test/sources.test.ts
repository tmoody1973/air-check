import { judgeClaim, LIMITS, sourceSays, type ClaimInput, type ResolvedSource } from "@aircheck/core";
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

  it("one page found by two searches keeps each chunk and its page text once (Oct 29 prefetch: merge on [...])", () => {
    const ledger = createSourceLedger();
    const page = `Glue is a single by Bicep. ${"Belfast duo. ".repeat(700)}`;
    const id = ledger.add(src("https://en.wikipedia.org/wiki/Glue", `Glue\nIt came out on Ninja Tune [...] DJ Mag track of the year\n${page}`));
    expect(ledger.add(src("https://en.wikipedia.org/wiki/Glue", `Glue\nDJ Mag track of the year [...] Video by Joe Wilson\n${page}`))).toBe(id);
    const text = ledger.get(id)!.text;
    for (const piece of ["It came out on Ninja Tune", "DJ Mag track of the year", "Video by Joe Wilson", "Glue is a single by Bicep."]) {
      expect(text.split(piece), piece).toHaveLength(2);
    }
  });

  it("caps text at 8,000 characters, and a repeat URL's new text still fits", () => {
    expect(SOURCE_TEXT_MAX).toBe(LIMITS.sourceText);
    const ledger = createSourceLedger();
    const id = ledger.add(src("https://example.org/a", "a".repeat(10_000)));
    expect(ledger.get(id)!.text).toHaveLength(8_000);
    ledger.add(src("https://example.org/a", "released 2026-10-10"));
    const text = ledger.get(id)!.text;
    expect(text.length).toBeLessThanOrEqual(8_000);
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
  it("skips a URL over 2,048 characters", () => {
    expect(urlsIn(`https://x.org/${"a".repeat(2_100)} https://x.org/ok`)).toEqual(["https://x.org/ok"]);
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
  const sourcesPart = (r: CallToolResult, body: string) => text(r).slice(body.length);
  const one = (body: string): CallToolResult => ({ content: [{ type: "text", text: body }] });

  it("R8b: plain text gives ids to the family's own pages only; other links get none", () => {
    const ledger = createSourceLedger();
    const body =
      "Artist A is a band. https://en.wikipedia.org/wiki/Artist_A https://label.example/press https://artista.bandcamp.com/album/home https://upload.wikimedia.org/a.jpg https://en.wikipedia.org/wiki/Cover.png";
    const out = annotateCrateResult(ledger, "wikipedia_summary", one(body));
    expect(text(out).startsWith(body)).toBe(true);
    expect(sourcesPart(out, body)).toMatch(/^\nSources:\n\[S[0-9a-z]{5}\] en\.wikipedia\.org$/);
    const [id] = idsIn(sourcesPart(out, body));
    expect(ledger.get(id!)).toMatchObject({ url: "https://en.wikipedia.org/wiki/Artist_A", text: body, via: "crate:wikipedia_summary" });
  });

  it("builds one MusicBrainz URL per listed item, with that item's own text and name", () => {
    const ledger = createSourceLedger();
    const a = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";
    const b = "0383dadf-2a4e-4d10-a46a-e9e041da8eb3";
    const body = JSON.stringify({ count: 2, releases: [{ id: a, title: "Home", date: "2026-10-10", url: "https://label.example/home" }, { id: b, title: "Away", date: "2025-01-01" }] });
    const all = text(annotateCrateResult(ledger, "musicbrainz_search_release", one(body)));
    const ids = idsIn(all.slice(body.length));
    expect(ids.map((id) => ledger.get(id)!.url)).toEqual([musicBrainzUrl("release", a), musicBrainzUrl("release", b)]);
    expect(musicBrainzUrl("release", a)).toBe(`https://musicbrainz.org/release/${a}`);
    expect(ledger.get(ids[0]!)).toMatchObject({ title: "Home", host: "musicbrainz.org" });
    expect(sourceSays(ledger.get(ids[0]!)!.text, "release-date", "2026-10-10")).toBe(true);
    expect(sourceSays(ledger.get(ids[1]!)!.text, "release-date", "2026-10-10")).toBe(false);
    expect(all).toContain(`[${ids[0]}] Home · musicbrainz.org`);
  });

  it("Oct 29: a long MusicBrainz release keeps its facts first, so the 8,000-character cap and the 300-character rule never hide them", () => {
    // Real-shaped: a release lookup with artist credits, labels and recordings, ids everywhere, label-info and
    // artist-credit after the tracklist. Placeholder names (Sample Honesty).
    const mbid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
    const credit = [{ name: "Artist A", joinphrase: "", artist: { id: mbid(900), name: "Artist A", "sort-name": "Artist A", disambiguation: "electronic duo", type: "Group", "type-id": mbid(901) } }];
    const tracks = Array.from({ length: 14 }, (_, i) => {
      const title = i === 1 ? "Title B" : `Other Track ${i + 1}`;
      const length = i === 1 ? 269_000 : 200_000 + i * 1_000;
      return {
        id: mbid(100 + i), position: i + 1, number: String(i + 1), title, length, "artist-credit": credit,
        recording: { id: mbid(200 + i), title, length, video: false, disambiguation: "", "first-release-date": "2017-09-01", "artist-credit": credit },
      };
    });
    const release = {
      id: mbid(1), title: "Album A", status: "Official", "status-id": mbid(2), quality: "normal", barcode: "5021392987124", disambiguation: "",
      packaging: "None", "packaging-id": mbid(3), "text-representation": { language: "eng", script: "Latn" },
      "cover-art-archive": { artwork: true, count: 3, front: true, back: false, darkened: false },
      date: "2017-09-01", country: "XW",
      "release-events": [{ date: "2017-09-01", area: { id: mbid(4), name: "[Worldwide]", "sort-name": "[Worldwide]", "iso-3166-1-codes": ["XW"], disambiguation: "" } }],
      media: [{ position: 1, title: "", format: "Digital Media", "format-id": mbid(5), "track-count": 14, "track-offset": 0, tracks }],
      "label-info": [{ "catalog-number": "ZEN243", label: { id: mbid(6), name: "Label A", "sort-name": "Label A", "label-code": 12666, type: "Original Production", "type-id": mbid(7), disambiguation: "" } }],
      "artist-credit": credit,
    };
    const body = JSON.stringify(release);
    expect(body.length).toBeGreaterThan(SOURCE_TEXT_MAX);
    const ledger = createSourceLedger();
    const [id] = idsIn(sourcesPart(annotateCrateResult(ledger, "musicbrainz_get_release", one(body)), body));
    const kept = ledger.get(id!)!.text;
    expect(kept.length).toBeLessThanOrEqual(SOURCE_TEXT_MAX);
    const near = ["Artist A", "Title B"];
    expect(sourceSays(kept, "label", "Label A", near)).toBe(true);
    expect(sourceSays(kept, "track-number", "2", near)).toBe(true);
    expect(sourceSays(kept, "length", "4:29", near)).toBe(true);
    expect(sourceSays(kept, "release-date", "1 September 2017", near)).toBe(true);
    expect(sourceSays(kept, "label", "Label B", near)).toBe(false);
    expect(kept).toContain(body.slice(0, 200)); // the item's own JSON follows the facts
  });

  it("names the entity a tool lists: artist releases are releases, release groups have their own path", () => {
    const ledger = createSourceLedger();
    const id = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";
    const urlFor = (tool: string, body: string) => idsIn(text(annotateCrateResult(ledger, tool, one(body)))).map((i) => ledger.get(i)!.url);
    expect(urlFor("musicbrainz_get_release_group", JSON.stringify({ id, title: "Home", tags: [{ name: "jazz" }] }))).toEqual([`https://musicbrainz.org/release-group/${id}`]);
    expect(urlFor("musicbrainz_get_artist_releases", JSON.stringify({ releases: [{ id, title: "Home" }] }))).toEqual([`https://musicbrainz.org/release/${id}`]);
    expect(urlFor("musicbrainz_search_artist", JSON.stringify({ artists: [{ id, name: "Artist A" }] }))).toEqual([`https://musicbrainz.org/artist/${id}`]);
  });

  it("R8b: an iTunes item is one source, its store page, never its artwork or preview", () => {
    const ledger = createSourceLedger();
    const item = {
      collectionName: "Home",
      artistViewUrl: "https://music.apple.com/us/artist/artist-a/1",
      collectionViewUrl: "https://music.apple.com/us/album/home/2",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
      releaseDate: "2026-10-10T07:00:00Z",
    };
    const body = JSON.stringify({ resultCount: 1, results: [item] });
    const out = annotateCrateResult(ledger, "itunes_search", one(body));
    const ids = idsIn(sourcesPart(out, body));
    expect(ids).toHaveLength(1);
    expect(ledger.get(ids[0]!)).toMatchObject({ url: item.collectionViewUrl, host: "music.apple.com", title: "Home", via: "crate:itunes_search" });
    expect(sourcesPart(out, body)).toBe(`\nSources:\n[${ids[0]}] Home · music.apple.com`);
    // Cited twice, it is still one publisher (core's family guard), so it cannot confirm alone.
    const claim: ClaimInput = { kind: "release-date", text: "Out 2026-10-10.", value: "2026-10-10", sources: [{ id: ids[0]! }, { id: ids[0]! }] };
    expect(judgeClaim(claim, { [ids[0]!]: ledger.get(ids[0]!)! }).status).toBe("could-not-verify");
  });

  it("names a source from title, name, collectionName or trackName", () => {
    const ledger = createSourceLedger();
    const body = JSON.stringify({ results: [{ trackName: "Song B", trackViewUrl: "https://music.apple.com/us/song/b/3" }] });
    expect(text(annotateCrateResult(ledger, "itunes_lookup", one(body)))).toMatch(/\[S[0-9a-z]{5}\] Song B · music\.apple\.com$/);
  });

  it("a result with no family page and no buildable id gets no source ids", () => {
    const ledger = createSourceLedger();
    const plain = one("Artist A: 3 releases, latest 2026. https://label.example/a");
    expect(annotateCrateResult(ledger, "itunes_search", plain)).toEqual(plain);
    const notMb = one(JSON.stringify([{ id: "5b11f4ce-a62d-471e-81fc-a69a8278c7da" }]));
    expect(annotateCrateResult(ledger, "itunes_search", notMb)).toEqual(notMb);
    const offFamily = one(JSON.stringify([{ title: "X", url: "https://label.example/x" }]));
    expect(annotateCrateResult(ledger, "bandcamp_search_bandcamp", offFamily)).toEqual(offFamily);
    const bandcampAsset = one(JSON.stringify([{ title: "X", url: "https://f4.bcbits.com/img/a.jpg" }]));
    expect(annotateCrateResult(ledger, "bandcamp_search_bandcamp", bandcampAsset)).toEqual(bandcampAsset);
  });

  it("a Bandcamp search item is one source on its own bandcamp.com page", () => {
    const ledger = createSourceLedger();
    const body = JSON.stringify([{ name: "Home", url: "https://artista.bandcamp.com/album/home", image: "https://f4.bcbits.com/img/a.jpg" }]);
    const ids = idsIn(sourcesPart(annotateCrateResult(ledger, "bandcamp_search_bandcamp", one(body)), body));
    expect(ids.map((i) => ledger.get(i)!.url)).toEqual(["https://artista.bandcamp.com/album/home"]);
  });

  it("leaves an error result alone", () => {
    const ledger = createSourceLedger();
    const err: CallToolResult = { content: [{ type: "text", text: "failed https://en.wikipedia.org/wiki/x" }], isError: true };
    expect(annotateCrateResult(ledger, "wikipedia_summary", err)).toEqual(err);
  });
});
