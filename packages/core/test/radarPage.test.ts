import { describe, expect, test } from "vitest";
import { MAX_ABOUT_CHARS, MAX_TAGS, bandcampArtUrl, bandcampTag, readBandcampDetails, readBandcampEmbed } from "../src/index";
import { readFixture } from "./helpers/fixtures";

// Plan 8 Task 6b: the same Bandcamp page the ingest worker reads for its player id also gives cover art, tags and the
// album description. Everything else on the page is discarded.

describe("bandcampArtUrl: only an https image on a *.bcbits.com host", () => {
  test("Bandcamp's own image URL is kept as is", () => {
    expect(bandcampArtUrl("https://f4.bcbits.com/img/a0000000001_5.jpg")).toBe("https://f4.bcbits.com/img/a0000000001_5.jpg");
    expect(bandcampArtUrl("https://f1.bcbits.com/img/0012345678_10.png")).toBe("https://f1.bcbits.com/img/0012345678_10.png");
  });
  test.each([
    "http://f4.bcbits.com/img/a1_5.jpg",
    "https://bcbits.com/img/a1_5.jpg",
    "https://f4.bcbits.com.evil.example/img/a1_5.jpg",
    "https://evil.example/f4.bcbits.com/img/a1_5.jpg",
    "https://f4.bcbits.com/img/a1_5.jpg?x=1",
    "https://f4.bcbits.com/img/a1_5.jpg#x",
    "https://u:p@f4.bcbits.com/img/a1_5.jpg",
    "https://f4.bcbits.com:8443/img/a1_5.jpg",
    "https://f4.bcbits.com/stream/a1_5.mp3",
    "https://f4.bcbits.com/img/a1_5.svg",
    "https://f4.bcbits.com/img/../a1_5.jpg",
    "javascript:alert(1)",
    "",
    "https://xbcbits.com/img/a_1.jpg",
    "https://f4.xbcbits.com/img/a_1.jpg",
    "https://f4.bcbits.com./img/a_1.jpg",
  ])("refused: %s", (u) => expect(bandcampArtUrl(u)).toBeNull());
});

describe("bandcampTag: a checked short word, lower-cased", () => {
  test("kept: letters, numbers, space, & ' - / and a dot before a space or the end", () => {
    expect(bandcampTag("Electronic")).toBe("electronic");
    expect(bandcampTag("  deep \n  house ")).toBe("deep house");
    expect(bandcampTag("R&B")).toBe("r&b");
    expect(bandcampTag("hip-hop/rap")).toBe("hip-hop/rap");
    expect(bandcampTag("Música Popular Brasileira")).toBe("música popular brasileira");
    expect(bandcampTag("St. Louis")).toBe("st. louis");
    expect(bandcampTag("rock 'n' roll")).toBe("rock 'n' roll");
  });
  test.each([
    "",
    "   ",
    "x".repeat(41),
    "ignore <rules>",
    "see: this",
    "a@b",
    "evil.example/a",
    "bit.ly",
    "www.x",
    "washington d.c.",
    "tag\u0000",
    "#hashtag",
  ])("refused: %j", (t) => expect(bandcampTag(t)).toBeNull());
  test("40 characters is the cap", () => expect(bandcampTag("x".repeat(40))).toBe("x".repeat(40)));
});

describe("readBandcampDetails", () => {
  const page = readFixture("bandcamp/album-page.html");

  test("art, tags and the about block from the fixture page; nothing else", () => {
    const d = readBandcampDetails(page);
    expect(Object.keys(d).sort()).toEqual(["about", "art", "tags"]);
    expect(d.art).toBe("https://f4.bcbits.com/img/a0000000001_5.jpg");
    // Checked, lower-cased, deduplicated; the link-shaped and the bracketed ones are dropped.
    expect(d.tags).toEqual(["electronic", "deep house", "r&b", "milwaukee"]);
    // Plain text: tags gone, entities decoded, links and addresses stripped, lines kept.
    expect(d.about).toBe("Recorded over one winter in a Milwaukee basement.\n\nMixed by Ana & Jo. Pre-order at [link] or write to [email]");
    expect(d.about).not.toMatch(/:\/\/|@|<|>/);
    // The player id still comes from the same page.
    expect(readBandcampEmbed(page)).toEqual({ kind: "album", id: "1234567890" });
  });

  test("no about block: og:description is the about", () => {
    expect(readBandcampDetails('<meta property="og:description" content="Ten songs &amp; a long goodbye. www.example.com">').about).toBe("Ten songs & a long goodbye. [link]");
  });

  test("an og:image off bcbits.com is no art; a page with nothing gives nothing", () => {
    expect(readBandcampDetails('<meta property="og:image" content="https://evil.example/img/a1_5.jpg">')).toEqual({});
    expect(readBandcampDetails("<html>nothing here</html>")).toEqual({});
  });

  test(`at most ${MAX_TAGS} tags; the about is at most ${MAX_ABOUT_CHARS} characters`, () => {
    const tags = Array.from({ length: 20 }, (_, i) => `<a class="tag" href="https://bandcamp.com/discover/t${i}">tag ${i}</a>`).join("\n");
    const about = `<div class="tralbumData tralbum-about">${"word ".repeat(1_000)}</div>`;
    const d = readBandcampDetails(`${about}${tags}`);
    expect(d.tags).toHaveLength(MAX_TAGS);
    expect(d.tags![0]).toBe("tag 0");
    expect(d.about!.length).toBeLessThanOrEqual(MAX_ABOUT_CHARS);
    expect(MAX_TAGS).toBe(12);
    expect(MAX_ABOUT_CHARS).toBe(2_000);
  });

  test("ordinary links never use up the tag scan: 300 plain links, then 3 tags", () => {
    const plain = Array.from({ length: 300 }, (_, i) => `<a href="https://x.example/${i}">link ${i}</a>`).join("\n");
    const tags = ["soul", "jazz", "house"].map((t) => `<a class="tag" href="https://bandcamp.com/discover/${t}">${t}</a>`).join("\n");
    expect(readBandcampDetails(`${plain}\n${tags}`).tags).toEqual(["soul", "jazz", "house"]);
  });

  test("an about of only whitespace or tags is no about", () => {
    expect(readBandcampDetails('<div class="tralbumData tralbum-about">  <br> </div>')).toEqual({});
  });
});

// Hand-written snippets of the two shapes a real page carries (no Bandcamp page is committed).
describe("readBandcampDetails: releasedOn (yyyy-mm-dd) from the same page", () => {
  const ld = (date: string) => `<script type="application/ld+json">{"@type":"MusicRecording","datePublished":"${date}","name":"x"}</script>`;
  const visible = (text: string) => `<div class="tralbumData tralbum-credits">\n    ${text}\n</div>`;
  const released = (html: string) => readBandcampDetails(html).releasedOn;

  test("JSON-LD datePublished", () => {
    expect(released(ld("29 Oct 2026 00:00:00 GMT"))).toBe("2026-10-29");
    expect(released(ld("1 Feb 2024 00:00:00 GMT"))).toBe("2024-02-01");
    expect(released('{"datePublished" : "29 Feb 2024 00:00:00 GMT"}')).toBe("2024-02-29");
  });

  test("the visible 'released Month D, YYYY' when there is no JSON-LD date", () => {
    expect(released(visible("released October 29, 2026"))).toBe("2026-10-29");
    expect(released(visible("released May 3, 1999"))).toBe("1999-05-03");
  });

  test("JSON-LD wins over the visible text", () => {
    expect(released(ld("2 Jan 2025 00:00:00 GMT") + visible("released March 9, 2020"))).toBe("2025-01-02");
  });

  test("a bad month, an impossible day or a year out of 1950-2100 is no date", () => {
    expect(released(ld("29 Okt 2026 00:00:00 GMT"))).toBeUndefined();
    expect(released(visible("released Octember 29, 2026"))).toBeUndefined();
    expect(released(ld("31 Apr 2026 00:00:00 GMT"))).toBeUndefined();
    expect(released(ld("29 Feb 2025 00:00:00 GMT"))).toBeUndefined();
    expect(released(visible("released February 30, 2026"))).toBeUndefined();
    expect(released(ld("0 Jan 2026 00:00:00 GMT"))).toBeUndefined();
    expect(released(ld("1 Jan 1949 00:00:00 GMT"))).toBeUndefined();
    expect(released(visible("released January 1, 2101"))).toBeUndefined();
    expect(released(ld("1 Jan 1950 00:00:00 GMT"))).toBe("1950-01-01");
    expect(released(visible("released December 31, 2100"))).toBe("2100-12-31");
  });

  test("absent: no date shape, or only the entity-encoded data-tralbum one", () => {
    expect(released("<html>nothing here</html>")).toBeUndefined();
    expect(released('<div data-tralbum="{&quot;release_date&quot;:&quot;29 Oct 2026 00:00:00 GMT&quot;}">')).toBeUndefined();
    expect(Object.keys(readBandcampDetails(ld("29 Oct 2026 00:00:00 GMT")))).toEqual(["releasedOn"]);
  });
});

describe("page parsing stays linear on a hostile 200k-character page", () => {
  const fast = (label: string, run: () => unknown) =>
    // The budget is the 200 ms; the 30 s timeout only gives a loaded machine time to run three tries.
    test(`${label} finishes under 200 ms`, { timeout: 30_000 }, () => {
      const times = [0, 1, 2].map(() => {
        const t = performance.now();
        run();
        return performance.now() - t;
      });
      expect(Math.min(...times)).toBeLessThan(200);
    });
  const N = 200_000;
  fast("one <meta with a 200k attribute name", () => readBandcampDetails(`<meta ${"a".repeat(N)}>`));
  fast("one <meta with a 200k unclosed quote", () => readBandcampDetails(`<meta property="og:image" content="${"a".repeat(N)}>`));
  fast("readBandcampEmbed on a 200k attribute name", () => readBandcampEmbed(`<meta ${"a".repeat(N)}>`));
  fast("a= runs inside one meta", () => readBandcampDetails(`<meta ${"a=".repeat(N / 2)}>`));
  fast("<a class=\"tag\" x 20k, unclosed", () => readBandcampDetails('<a class="tag" '.repeat(N / 15)));
  fast("<a then 200k text, no </a>", () => readBandcampDetails(`<a class="tag">${"x".repeat(N)}`));
  fast("<a x 100k", () => readBandcampDetails("<a".repeat(N / 2)));
  fast("tralbum-about x 15k", () => readBandcampDetails('class="tralbum-about"'.repeat(N / 21)));
  fast("an unclosed about block with 200k of text and <br>", () => readBandcampDetails(`<div class="tralbum-about">${"a<br>".repeat(N / 5)}`));
  fast("an about block of 200k dotted words", () => readBandcampDetails(`<div class="tralbum-about">${"a.".repeat(N / 2)}</div>`));
  fast('"datePublished":"1 Jan  x 8k, never a year', () => readBandcampDetails('"datePublished":"1 Jan '.repeat(N / 23)));
  fast("released October 1,  x 9k, never a year", () => readBandcampDetails("released October 1, ".repeat(N / 21)));
  fast("200k digits after a released month", () => readBandcampDetails(`released October ${"1".repeat(N)}`));
  fast("bandcampTag on 200k characters",() => bandcampTag("a.".repeat(N / 2)));
  fast("bandcampArtUrl on 200k characters", () => bandcampArtUrl(`https://f4.bcbits.com/img/${"a".repeat(N)}.jpg`));
});
