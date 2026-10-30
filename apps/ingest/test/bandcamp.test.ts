import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { bandcampEmbed, embedPass } from "../src/bandcamp.js";
import { readText } from "../src/http.js";
import { fakeRadar } from "./convexFake.js";
import { stubHttp, timeoutError } from "./fakes.js";

const ALBUM = "https://palesignal.bandcamp.com/album/glass-weather";
const TRACK = "https://ferrolane.bandcamp.com/track/night-rooms";
const html = (name: string) => readFileSync(new URL(`../../../fixtures/bandcamp/${name}.html`, import.meta.url), "utf8");
const page = (body: ConstructorParameters<typeof Response>[0], status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const moved = (location: string, onCancel?: () => void) =>
  new Response(new ReadableStream({ pull: (c) => c.enqueue(new TextEncoder().encode("<a>moved</a>")), cancel: onCancel }), { status: 301, headers: { location } });

afterEach(() => vi.restoreAllMocks());

describe("bandcampEmbed: the one allowlisted page fetch (Hard Rule 5's exception)", () => {
  test("happy path: one GET to exactly the queued page, no cookie or authorization, redirect manual; the album id from og:video", async () => {
    const cv = fakeRadar([], [{ releaseId: "r1", pageUrl: ALBUM }]);
    const s = stubHttp(() => page(html("album-meta")));
    await embedPass({ convex: cv.convex, log: () => {}, http: s.http, sleep: async () => {} });
    expect(s.sent).toHaveLength(1);
    const { url, init } = s.sent[0]!;
    expect(url).toBe(ALBUM);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect([...headers.keys()]).toEqual(["accept", "user-agent"]);
    expect(headers.get("accept")).toBe("text/html");
    expect(headers.get("user-agent")).toBe("AirCheck/1.0 (Radio Milwaukee release radar)");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(cv.results).toEqual([{ releaseId: "r1", pageUrl: ALBUM, result: { kind: "album", id: "1234567890", art: "https://f4.bcbits.com/img/a0000000001_5.jpg" } }]);
  });

  test("Task 6b: the same one request also gives cover art, tags and the about; nothing else from the page", async () => {
    const cv = fakeRadar([], [{ releaseId: "r1", pageUrl: ALBUM }]);
    const s = stubHttp(() => page(html("album-page")));
    await embedPass({ convex: cv.convex, log: () => {}, http: s.http, sleep: async () => {} });
    expect(s.sent.map((x) => x.url)).toEqual([ALBUM]); // no second fetch: not the art, not a tag link
    const { result } = cv.results[0]!;
    expect(Object.keys(result).sort()).toEqual(["about", "art", "id", "kind", "tags"]);
    expect(result).toMatchObject({ kind: "album", id: "1234567890", art: "https://f4.bcbits.com/img/a0000000001_5.jpg", tags: ["electronic", "deep house", "r&b", "milwaukee"] });
    expect((result as { about: string }).about).toMatch(/^Recorded over one winter/);
    expect(JSON.stringify(result)).not.toMatch(/:\/\/[^"]*bandcamp|@|merch/);
  });

  test("the release date and the page artist from the same request are carried through to embedResult", async () => {
    const cv = fakeRadar([], [{ releaseId: "r1", pageUrl: ALBUM }]);
    const dated = html("album-page").replace("</head>", '<script type="application/ld+json">{"datePublished":"29 Oct 2026 00:00:00 GMT","byArtist":{"@type":"MusicGroup","name":"Ferro Lane"}}</script></head>');
    const s = stubHttp(() => page(dated));
    await embedPass({ convex: cv.convex, log: () => {}, http: s.http, sleep: async () => {} });
    expect(s.sent).toHaveLength(1);
    expect(cv.results[0]!.result).toMatchObject({ kind: "album", id: "1234567890", releasedOn: "2026-10-29", pageArtist: "Ferro Lane" });
  });

  test("Task 6b: a page with no player still gives no_player, and its details are dropped with it", async () => {
    const off = html("album-page").replaceAll("https://bandcamp.com/EmbeddedPlayer/", "https://evil.example/EmbeddedPlayer/");
    expect(await bandcampEmbed(stubHttp(() => page(off)).http, ALBUM)).toEqual({ failed: "no_player" });
  });

  test("a track page gives the track id", async () => {
    expect(await bandcampEmbed(stubHttp(() => page(html("track-meta"))).http, TRACK)).toMatchObject({ kind: "track", id: "987654321" });
  });

  test.each([
    "http://x.bandcamp.com/album/a",
    "https://bandcamp.com.evil.example/album/a",
    "https://x.bandcamp.com/album/a?pk=123",
    "https://x.bandcamp.com/merch",
    "https://evil.example/album/a",
    "javascript:alert(1)",
  ])("refused before any request: %s", async (u) => {
    const s = stubHttp(() => page(html("album-meta")));
    expect(await bandcampEmbed(s.http, u)).toEqual({ failed: "not_allowed" });
    expect(s.sent).toEqual([]);
  });

  test("a 301 to another Bandcamp album page is followed (a relative Location too)", async () => {
    const s = stubHttp((_u, _i, n) => (n === 1 ? moved("https://other.bandcamp.com/album/b") : n === 2 ? moved("/album/c") : page(html("album-meta"))));
    expect(await bandcampEmbed(s.http, ALBUM)).toMatchObject({ kind: "album", id: "1234567890" });
    expect(s.sent.map((x) => x.url)).toEqual([ALBUM, "https://other.bandcamp.com/album/b", "https://other.bandcamp.com/album/c"]);
    for (const x of s.sent) expect(x.init.redirect).toBe("manual");
  });

  test("a 301 off Bandcamp costs one request, is never followed, and its body is cancelled", async () => {
    for (const to of ["https://evil.example/x", "http://other.bandcamp.com/album/b", "https://other.bandcamp.com/album/b?pk=1", "//evil.example/x"]) {
      let cancelled = false;
      const s = stubHttp(() => moved(to, () => void (cancelled = true)));
      expect(await bandcampEmbed(s.http, ALBUM)).toEqual({ failed: "redirect_off_host" });
      expect(s.sent).toHaveLength(1);
      expect(cancelled).toBe(true);
    }
  });

  test("three Bandcamp hops: too_many_redirects after three requests", async () => {
    const s = stubHttp((_u, _i, n) => moved(`https://hop${n}.bandcamp.com/album/a`));
    expect(await bandcampEmbed(s.http, ALBUM)).toEqual({ failed: "too_many_redirects" });
    expect(s.sent).toHaveLength(3);
  });

  test("limits: 3 MB is too_large, JSON is not_html, a 404 is http_404", async () => {
    expect(await bandcampEmbed(stubHttp(() => page("<p>" + "x".repeat(3 * 1024 ** 2))).http, ALBUM)).toEqual({ failed: "too_large" });
    expect(await bandcampEmbed(stubHttp(() => page("<p>x</p>", 200, { "content-length": String(3 * 1024 ** 2) })).http, ALBUM)).toEqual({ failed: "too_large" });
    expect(await bandcampEmbed(stubHttp(() => new Response("{}", { headers: { "content-type": "application/json" } })).http, ALBUM)).toEqual({ failed: "not_html" });
    expect(await bandcampEmbed(stubHttp(() => new Response("<p>x</p>")).http, ALBUM)).toEqual({ failed: "not_html" });
    expect(await bandcampEmbed(stubHttp(() => page("gone", 404)).http, ALBUM)).toEqual({ failed: "http_404" });
  });

  test("a hang past 15 seconds is timeout (the request carries a 15 s signal)", async () => {
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const s = stubHttp((_u, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(timeoutError());
    });
    expect(await bandcampEmbed(s.http, ALBUM)).toEqual({ failed: "timeout" });
    expect(timeouts).toHaveBeenCalledWith(15_000);
  });

  test("a page whose og:video points off bandcamp.com/EmbeddedPlayer/ is no_player", async () => {
    const off = html("album-meta").replaceAll("https://bandcamp.com/EmbeddedPlayer/", "https://evil.example/EmbeddedPlayer/");
    expect(await bandcampEmbed(stubHttp(() => page(off)).http, ALBUM)).toEqual({ failed: "no_player" });
  });

  test("any other fetch failure is network, never a thrown error", async () => {
    expect(await bandcampEmbed(stubHttp(() => Promise.reject(new TypeError("fetch failed"))).http, ALBUM)).toEqual({ failed: "network" });
  });
});

describe("readText's cap is enforced while streaming", () => {
  test("a 10 MB chunked body with no content-length stops after the cap, not after the whole body", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(256 * 1024);
    const body = new ReadableStream({ pull: (c) => (++pulled > 40 ? c.close() : c.enqueue(chunk)) });
    await expect(readText(new Response(body), 2 * 1024 ** 2)).rejects.toThrow("too_large");
    expect(pulled).toBeLessThanOrEqual(10);
  });

  test("a body under the cap is read whole, BOM dropped", async () => {
    expect(await readText(new Response("﻿hello"), 100)).toBe("hello");
  });
});

describe("embedPass", () => {
  test("five queued pages: three this pass, two the next, at least 2 s apart; one failure does not stop the others", async () => {
    const pages = [1, 2, 3, 4, 5].map((i) => ({ releaseId: `r${i}`, pageUrl: `https://label${i}.bandcamp.com/album/a${i}` }));
    const cv = fakeRadar([], pages);
    const events: string[] = [];
    const s = stubHttp((url) => {
      events.push("fetch");
      return url.includes("label2") ? page("gone", 404) : page(html("album-meta"));
    });
    const logs: string[] = [];
    const d = { convex: cv.convex, log: (l: string) => void logs.push(l), http: s.http, sleep: async (ms: number) => void events.push(`sleep ${ms}`) };
    await embedPass(d);
    expect(cv.results.map((r) => r.releaseId)).toEqual(["r1", "r2", "r3"]);
    expect(events).toEqual(["fetch", "sleep 2000", "fetch", "sleep 2000", "fetch"]);
    await embedPass(d);
    const ok = { kind: "album", id: "1234567890", art: "https://f4.bcbits.com/img/a0000000001_5.jpg" };
    expect(cv.results.map((r) => [r.releaseId, r.result])).toEqual([["r1", ok], ["r2", { failed: "http_404" }], ["r3", ok], ["r4", ok], ["r5", ok]]);
    await embedPass(d);
    expect(s.sent).toHaveLength(5);
    // Hard Rule 8: steps and codes only.
    expect(logs).toHaveLength(5);
    for (const l of logs) {
      expect(l).toMatch(/^ingest step=bandcamp-embed ok=(true|false) code=[a-z_0-9]+ ms=\d+$/);
      for (const bad of ["bandcamp.com", "http:", "https", "label", "glass", "r1"]) expect(l).not.toContain(bad);
    }
    expect(logs[1]).toMatch(/ok=false code=http_404/);
  });

  test("an embedResult that throws is logged and the next page still runs", async () => {
    const cv = fakeRadar([], [{ releaseId: "r1", pageUrl: ALBUM }, { releaseId: "r2", pageUrl: TRACK }]);
    const real = cv.convex.embedResult;
    let first = true;
    cv.convex.embedResult = async (...a) => {
      if (first) { first = false; throw new Error(`no such page ${ALBUM}`); }
      return real(...a);
    };
    const logs: string[] = [];
    await embedPass({ convex: cv.convex, log: (l) => void logs.push(l), http: stubHttp((u) => page(html(u === TRACK ? "track-meta" : "album-meta"))).http, sleep: async () => {} });
    expect(cv.results.map((r) => r.releaseId)).toEqual(["r2"]);
    expect(logs[0]).toMatch(/^ingest step=bandcamp-embed ok=false code=record_failed ms=\d+$/);
  });
});

describe("Oct 30: Bandcamp's bot check", () => {
  test("a Client Challenge page is its own failure, challenged, not no_player", async () => {
    const challenge = "<!DOCTYPE html><html><head><title>Client Challenge</title></head><body><noscript>JavaScript is disabled</noscript></body></html>";
    expect(await bandcampEmbed(stubHttp(() => page(challenge)).http, ALBUM)).toEqual({ failed: "challenged" });
  });
});
