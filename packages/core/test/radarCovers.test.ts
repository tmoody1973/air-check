import { describe, expect, test } from "vitest";
import {
  checkExtractions,
  cleanMail,
  coverArtUrl,
  markedMedia,
  parseAllowlist,
  pickInbound,
  readVerdict,
  senderDecision,
  stripLinks,
  type CleanMail,
  type InboundMail,
} from "../src/index";
import { readFixture } from "./helpers/fixtures";

// Decision 027 (Oct 30, Tarik): "get the links and album artwork in emails if available." The cleaner keeps each
// allowed cover's address and puts a numbered [image N] / [link N] marker where it was; the reader answers with numbers
// only; Convex maps numbers to the stored addresses. Nothing fetches an image or a link.

const H = "0a1b2c3d4e5f60718293a4b5c";
const COVER1 = `https://mcusercontent.com/${H}/images/11111111-aaaa-4bbb-8ccc-000000000001.jpg`;
const COVER2 = `https://gallery.mailchimp.com/${H}/images/22222222-aaaa-4bbb-8ccc-000000000002.png`;
const COVER3 = "https://f4.bcbits.com/img/a0000000003_10.jpg";
const OCT22 = Date.UTC(2026, 9, 22, 15);
const ALLOW = parseAllowlist("tarik@radiomilwaukee.org");

const fixture = (): Record<string, unknown> => JSON.parse(readFixture("email/cosign-mailchimp-roundup.json"));
function cleaned(over: Partial<InboundMail> = {}, tab: "cosign" | "bandcamp" = "cosign"): CleanMail {
  const raw = fixture();
  const m = { ...pickInbound(raw)!, ...over };
  const d = senderDecision(m, ALLOW, readVerdict(raw));
  if (!d.ok) throw new Error(d.reason);
  return cleanMail(m, { ...d, tab });
}
/** The stored address a [link N] marker in `text` names, each in order. */
const linksIn = (text: string, links: string[]) => [...text.matchAll(/\[link (\d+)\]/g)].map((m) => links[Number(m[1]) - 1]);

describe("coverArtUrl: the cover allowlist (Bandcamp's and Mailchimp's image hosts)", () => {
  test.each([
    [COVER1, COVER1],
    [`${COVER1}?w=300&utm_source=x#top`, COVER1], // these hosts serve the image without its query: dropped
    [COVER2, COVER2],
    [`https://mcusercontent.com/${H}/_compresseds/33333333-aaaa-4bbb-8ccc-000000000003.jpg`, `https://mcusercontent.com/${H}/_compresseds/33333333-aaaa-4bbb-8ccc-000000000003.jpg`],
    [COVER3, COVER3],
    [`${COVER3}?x=1`, COVER3],
  ])("kept: %s", (raw, want) => expect(coverArtUrl(raw)).toBe(want));
  test.each([
    `http://mcusercontent.com/${H}/images/a.jpg`, // not https
    `https://user:pw@mcusercontent.com/${H}/images/a.jpg`,
    `https://mcusercontent.com:8443/${H}/images/a.jpg`,
    `https://mcusercontent.com.evil.example/${H}/images/a.jpg`,
    `https://evil.mcusercontent.com/${H}/images/a.jpg`, // only the exact Mailchimp hosts
    `https://mcusercontent.com/${H}/files/a.pdf`, // an image path only
    `https://mcusercontent.com/${H}/images/a.svg`,
    `https://mcusercontent.com/${H}/images/spacer.gif`, // a spacer by name
    `https://mcusercontent.com/${H}/images/tracking-pixel.png`,
    "https://co-sign.us1.list-manage.com/track/open.php?u=abc&id=def",
    "https://cdn.sponsor.example.invalid/ad.jpg",
    "https://bcbits.com/img/a1_5.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    `https://mcusercontent.com/${H}/images/${"a".repeat(600)}.jpg`,
  ])("refused: %s", (raw) => expect(coverArtUrl(raw)).toBeNull());
});

describe("cleanMail: covers and numbered links from a Mailchimp roundup", () => {
  test("three covers kept in order with a marker each; pixels, spacer and the sponsor's host dropped", () => {
    const c = cleaned();
    expect(c.images).toEqual([COVER1, COVER2, COVER3]);
    const at = [1, 2, 3].map((n) => c.body.indexOf(`[image ${n}]`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(c.body.indexOf("[image 1]")).toBeLessThan(c.body.indexOf("Ferro Lane"));
    expect(c.body.indexOf("Ferro Lane")).toBeLessThan(c.body.indexOf("[image 2]"));
    expect(c.body.indexOf("[image 2]")).toBeLessThan(c.body.indexOf("Nova Reyes"));
    expect(c.body.indexOf("[image 3]")).toBeLessThan(c.body.indexOf("Ama Trio"));
    expect(c.body).not.toMatch(/\[image [4-9]\]|sponsor\.example|list-manage|spacer/);
  });
  test("each [link N] names the stored link at N, so a release's links sit next to it", () => {
    const c = cleaned();
    const parts = c.body.split(/\[image \d\]/);
    expect(new Set(linksIn(parts[1]!, c.links))).toEqual(new Set(["https://co-sign.example.invalid/release/2001", "https://ferrolane.bandcamp.com/album/glass-weather"]));
    expect(linksIn(parts[2]!, c.links)).toEqual(["https://co-sign.example.invalid/release/2002"]);
    expect(linksIn(parts[3]!, c.links)).toEqual(["https://co-sign.example.invalid/release/2003"]);
    expect(c.links).not.toContain(undefined);
    expect(c.links.join(" ")).not.toMatch(/unsubscribe|list-manage|utm_/);
    expect(c.bandcampPages).toEqual(["https://ferrolane.bandcamp.com/album/glass-weather"]);
  });
  test("stored text holds no ://, @ or www., and the forward is unwrapped from the HTML too", () => {
    const c = cleaned();
    for (const bad of ["://", "@", "www."]) {
      expect(c.body).not.toContain(bad);
      expect(c.subject).not.toContain(bad);
    }
    expect(c.body).not.toContain("Worth a look");
    expect(c.body).not.toMatch(/[-]/); // no working placeholder left behind
    expect(c.sender).toMatchObject({ address: "newmusic@co-sign.example.invalid" });
  });
  test("an image on a host off the list is dropped even when it is the only one: no images, plain-text body kept", () => {
    const html = `<p>Ferro Lane - Glass Weather</p><img src="https://cdn.sponsor.example.invalid/cover.jpg" width="300" height="300">`;
    const c = cleaned({ html, hrefs: [], text: "Ferro Lane - Glass Weather\nMore info https://co-sign.example.invalid/release/2001" });
    expect(c.images).toBeUndefined();
    expect(c.body).toBe("Ferro Lane - Glass Weather\nMore info [link 1]");
    expect(c.links).toEqual(["https://co-sign.example.invalid/release/2001"]);
  });
  test("a Bandcamp-tab email keeps its plain-text body and no images (its cover comes from the Bandcamp page)", () => {
    const c = cleaned({}, "bandcamp");
    expect(c.images).toBeUndefined();
    expect(c.body).not.toMatch(/\[image \d+\]/);
  });
  test("markers an email writes itself are flattened, and a placeholder character it sends is dropped", () => {
    const c = cleaned({ html: undefined, text: "Ferro Lane [image 2] [link 1] [Link 7]i0 https://co-sign.example.invalid/release/2001" });
    expect(c.body).toBe("Ferro Lane [image] [link] [Link]i0 [link 1]");
    const h = cleaned({ html: `<p>Ferro Lane [image 9] &#xE000;i0&#xE001;</p><img src="${COVER1}" width="300" height="300">` });
    expect(h.body).not.toMatch(/\[image 9\]|[-]/);
    expect(h.body).toContain("[image 1]");
  });
  test("at most 20 covers; the same cover twice is one number", () => {
    const many = Array.from({ length: 25 }, (_, i) => `<img src="https://mcusercontent.com/${H}/images/c${i}.jpg" width="300" height="300">`);
    const c = cleaned({ html: `<p>Roundup</p><img src="${COVER1}" width="200" height="200">${many.join("")}<img src="${COVER1}?w=1">` });
    expect(c.images).toHaveLength(20);
    expect(c.body.match(/\[image 1\]/g)).toHaveLength(2);
    expect(c.body).not.toContain("[image 21]");
  });
  test("plain-text mail numbers its links too; a dropped link stays a bare [link]", () => {
    const c = cleaned({ html: undefined, hrefs: [], text: "A https://a.example/x and B https://a.example/x?utm_source=y then https://co-sign.example.invalid/unsubscribe" });
    expect(c.links).toEqual(["https://a.example/x"]);
    expect(c.body).toBe("A [link 1] and B [link 1] then [link]");
  });
  test("the exported stripLinks still writes bare [link] (page text and the reader's re-check use it)", () => {
    expect(stripLinks("see https://a.example/x").text).toBe("see [link]");
    expect(stripLinks("already [link 3] and [image 2]").text).toBe("already [link 3] and [image 2]");
  });
});

describe("checkExtractions: a release's cover and links are marker numbers, never addresses", () => {
  const email = "Subject: New music\n\n[image 1] [link 1] Ferro Lane - Glass Weather [link 2]\n[image 2] Nova Reyes - Salt & Light [link 3]\nAma Trio - Way Out [link 4]";
  const run = (releases: unknown[]) => checkExtractions({ releases }, email, OCT22);
  test("numbers that are markers in the email are kept with each release", () => {
    const r = run([
      { artist: "Ferro Lane", title: "Glass Weather", image: 1, links: [1, 2] },
      { artist: "Nova Reyes", title: "Salt & Light", image: 2, links: [3] },
      { artist: "Ama Trio", title: "Way Out", links: [4] },
    ]);
    expect(r).toMatchObject({ ok: true, notes: [] });
    if (!r.ok) throw new Error("refused");
    expect(r.releases.map((x) => [x.image, x.links])).toEqual([[1, [1, 2]], [2, [3]], [undefined, [4]]]);
  });
  test("a number that is not a marker in the email is dropped, with a note that names no value", () => {
    const r = run([{ artist: "Ferro Lane", title: "Glass Weather", image: 3, links: [1, 9, 0, -1, 1.5, 2, 2] }]);
    if (!r.ok) throw new Error("refused");
    expect(r.releases[0]).toEqual({ artist: "Ferro Lane", title: "Glass Weather", links: [1, 2] });
    expect(r.notes.join(" ")).toMatch(/cover was left out/);
    expect(r.notes.join(" ")).toMatch(/links were left out/);
    expect(r.notes.join(" ")).not.toMatch(/\d/);
  });
  test("an address in the reader's answer is refused: never kept as a cover or a link", () => {
    const r = run([{ artist: "Ferro Lane", title: "Glass Weather", image: COVER1, links: ["https://evil.example/a", "2", 2] }]);
    if (!r.ok) throw new Error("refused");
    expect(r.releases[0]).toEqual({ artist: "Ferro Lane", title: "Glass Weather", links: [2] });
    expect(JSON.stringify(r)).not.toMatch(/https?:|evil|mcusercontent/);
  });
  test("a marker given as a field value is not a name or label", () => {
    const r = run([{ artist: "Ferro Lane", title: "Glass Weather", label: "[image 1]" }]);
    if (!r.ok) throw new Error("refused");
    expect(r.releases[0]).not.toHaveProperty("label");
    expect(checkExtractions({ releases: [{ artist: "[link 2]", title: "Glass Weather" }] }, email, OCT22)).toMatchObject({ ok: false });
  });
  test("no image and no links keys: none added", () => {
    const r = run([{ artist: "Ama Trio", title: "Way Out" }]);
    if (!r.ok) throw new Error("refused");
    expect(r.releases[0]).toEqual({ artist: "Ama Trio", title: "Way Out" });
  });
});

describe("markedMedia: numbers to the stored addresses (Convex's record path)", () => {
  const images = [COVER1, COVER2, "https://cdn.sponsor.example.invalid/ad.jpg"];
  const links = ["https://co-sign.example.invalid/release/2001", "https://ferrolane.bandcamp.com/album/glass-weather", "https://co-sign.example.invalid/release/2002"];
  test("each number picks its own address", () => {
    expect(markedMedia({ image: 2, links: [3, 1] }, images, links)).toEqual({ art: COVER2, links: [links[2], links[0]] });
  });
  test("out of range or off the cover list: nothing; no links key: undefined, so the old all-links rule applies", () => {
    expect(markedMedia({ image: 3 }, images, links)).toEqual({});
    expect(markedMedia({ image: 9, links: [7, 0] }, images, links)).toEqual({});
    expect(markedMedia({}, images, links)).toEqual({});
  });
});

describe("the HTML reader stays linear on hostile input (decision 027)", () => {
  // Same budget as radar.test.ts's hostile-input checks: the best of three runs under 200 ms.
  const fast = (label: string, html: string) =>
    test(`${label} finishes under 200 ms`, { timeout: 30_000 }, () => {
      const times = [0, 1, 2].map(() => {
        const t = performance.now();
        cleaned({ html });
        return performance.now() - t;
      });
      expect(Math.min(...times)).toBeLessThan(200);
    });
  fast("200k of unclosed <img", "<img ".repeat(40_000));
  fast("one 200k image tag of width= runs", `<img ${"width=".repeat(33_000)}>`);
  fast("one 200k image tag of src= runs", `<img ${" src=".repeat(40_000)}>`);
  fast("20k covers", `<img src="${COVER1}" width="300">`.repeat(1_500));
  fast("200k of [image 1 runs", "[image 1".repeat(25_000));
});
