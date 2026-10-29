import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLE_MUSIC_SEARCH_URL, appleMusicToken, catalogLine, createAppleMusic, loadAppleMusic, MAX_TOKEN_LIFETIME_S } from "../src/appleMusic.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const TEAM = "TEAM123456";
const KID = "KEY1234567";
const NOW_S = 1_800_000_000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

const album = (n: number) => ({
  id: `a${n}`,
  type: "albums",
  attributes: {
    name: `Album ${n}`,
    artistName: "Artist A",
    releaseDate: "2026-10-10",
    recordLabel: "Label A",
    copyright: "℗ 2026 Label A",
    upc: "886449464326",
    url: `https://music.apple.com/us/album/album-${n}/100${n}`,
    artwork: { url: "https://is3-ssl.mzstatic.com/image/thumb/x/{w}x{h}bb.jpg" },
  },
});
const song = (n: number) => ({
  id: `s${n}`,
  type: "songs",
  attributes: {
    name: `Song ${n}`,
    artistName: "Artist A",
    albumName: "Album 1",
    releaseDate: "2026-10-10",
    isrc: "USSM12600001",
    url: `https://music.apple.com/us/song/song-${n}/200${n}`,
    previews: [{ url: "https://audio-ssl.itunes.apple.com/preview.m4a" }],
  },
});
const answer = (albums: unknown[], songs: unknown[]) => json(200, { results: { albums: { data: albums }, songs: { data: songs } } });

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("appleMusicToken", () => {
  it("is an ES256 JWT with kid, iss, iat and exp within Apple's limit, verifiable with the public key", () => {
    const token = appleMusicToken({ teamId: TEAM, keyId: KID, key: privateKey }, NOW_S);
    const [h, c, s] = token.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "ES256", kid: KID });
    const claims = decode(c);
    expect(claims).toEqual({ iss: TEAM, iat: NOW_S, exp: expect.any(Number) });
    expect((claims.exp as number) - NOW_S).toBeGreaterThan(0);
    expect((claims.exp as number) - NOW_S).toBeLessThanOrEqual(15_777_000);
    expect(MAX_TOKEN_LIFETIME_S).toBe(15_777_000);
    const sig = Buffer.from(s, "base64url");
    expect(sig).toHaveLength(64); // raw r||s, not DER
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
  });
});

describe("createAppleMusic().search", () => {
  function setup(reply: () => Response | Promise<Response> = () => answer([album(1)], [song(1)]), now = () => NOW_S * 1000) {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => reply());
    const apple = createAppleMusic({ teamId: TEAM, keyId: KID, key: privateKey }, { fetch: fetch as typeof globalThis.fetch, now });
    return { apple, fetch };
  }

  it("sends one GET to the US catalog search with term, types and limit, and the developer token", async () => {
    const { apple, fetch } = setup();
    await apple.search("artist a album 1");
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${APPLE_MUSIC_SEARCH_URL}?term=artist+a+album+1&types=albums%2Csongs&limit=5`);
    expect(APPLE_MUSIC_SEARCH_URL).toBe("https://api.music.apple.com/v1/catalog/us/search");
    expect(init?.method ?? "GET").toBe("GET");
    const auth = (init!.headers as Record<string, string>).authorization!;
    expect(auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const [h, c, s] = auth.slice(7).split(".") as [string, string, string];
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
    expect(init!.body).toBeUndefined();
  });

  it("turns albums and songs into code-built lines on their music.apple.com pages, albums first", async () => {
    const { apple } = setup();
    expect(await apple.search("artist a")).toEqual([
      {
        url: "https://music.apple.com/us/album/album-1/1001",
        title: '"Album 1" by Artist A',
        text: 'Apple Music: "Album 1" by Artist A · released 2026-10-10 · label Label A · ℗ 2026 Label A · UPC 886449464326',
      },
      {
        url: "https://music.apple.com/us/song/song-1/2001",
        title: '"Song 1" by Artist A',
        text: 'Apple Music: "Song 1" by Artist A · from "Album 1" · released 2026-10-10 · ISRC USSM12600001',
      },
    ]);
  });

  it("never carries artwork or preview links", async () => {
    const { apple } = setup();
    const out = JSON.stringify(await apple.search("artist a"));
    expect(out).not.toMatch(/mzstatic|preview|\.m4a/);
  });

  it("keeps at most 5 results in total", async () => {
    const { apple } = setup(() => answer([1, 2, 3, 4].map(album), [1, 2, 3, 4].map(song)));
    const out = await apple.search("artist a");
    expect(out.map((r) => r.title)).toEqual(['"Album 1" by Artist A', '"Album 2" by Artist A', '"Album 3" by Artist A', '"Album 4" by Artist A', '"Song 1" by Artist A']);
  });

  it("drops an item whose page is not https on music.apple.com", async () => {
    const bad = [
      { attributes: { ...album(2).attributes, url: "http://music.apple.com/us/album/x/1" } },
      { attributes: { ...album(3).attributes, url: "https://evil.example/album" } },
      { attributes: { ...album(4).attributes, url: undefined } },
      null,
      "x",
    ];
    const { apple } = setup(() => answer([...bad, album(1)], []));
    expect((await apple.search("artist a")).map((r) => r.url)).toEqual(["https://music.apple.com/us/album/album-1/1001"]);
  });

  it("an empty search is no results", async () => {
    const { apple } = setup(() => json(200, { results: {} }));
    expect(await apple.search("artist a")).toEqual([]);
  });

  it.each([
    ["a timeout", () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })), "Apple Music lookup timed out."],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed")), "Apple Music could not be reached."],
    ["a 401", () => json(401, { errors: [{ detail: "bad token" }] }), "Apple Music lookup failed (HTTP 401)."],
    ["non-JSON", () => new Response("<html>", { status: 200 }), "Apple Music gave an unreadable answer."],
    ["no results member", () => json(200, { data: [] }), "Apple Music gave an unreadable answer."],
    ["a body over the size cap", () => json(200, { results: {}, pad: "x".repeat(300_000) }), "Apple Music gave an unreadable answer."],
  ])("%s is a plain-sentence error", async (_, reply, sentence) => {
    const { apple } = setup(reply as () => Promise<Response>);
    await expect(apple.search("artist a")).rejects.toThrow(new Error(sentence));
  });

  it("reuses the token, and mints a new one well before it expires", async () => {
    let now = NOW_S * 1000;
    const { apple, fetch } = setup(undefined, () => now);
    const auth = (i: number) => (fetch.mock.calls[i]![1]!.headers as Record<string, string>).authorization;
    await apple.search("a");
    now += 60 * 60 * 1000;
    await apple.search("b");
    expect(auth(1)).toBe(auth(0));
    now += 11 * 60 * 60 * 1000; // 12 h after minting: past the refresh point
    await apple.search("c");
    expect(auth(2)).not.toBe(auth(0));
    const exp = decode(auth(0)!.slice(7).split(".")[1]!).exp as number;
    expect(exp - NOW_S).toBe(12 * 60 * 60);
  });

  it("logs nothing", async () => {
    const { apple } = setup();
    await apple.search("secret artist");
    expect(logs).toEqual([]);
  });
});

describe("catalogLine", () => {
  it("leaves out missing fields, folds whitespace and caps at 2,000 characters", () => {
    expect(catalogLine({ name: " A\n B ", artistName: "C" })).toBe('Apple Music: "A B" by C');
    expect(catalogLine({ name: "x".repeat(5_000), copyright: "y".repeat(5_000) }).length).toBeLessThanOrEqual(2_000);
  });
});

describe("loadAppleMusic", () => {
  const dir = mkdtempSync(join(tmpdir(), "apple-"));
  const keyFile = join(dir, "AuthKey.p8");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));

  it("is unavailable without config", () => {
    expect(loadAppleMusic(undefined)).toBeUndefined();
    expect(logs).toEqual([]);
  });

  it("is unavailable, and says so without the path or key, when the key file cannot be read", () => {
    expect(loadAppleMusic({ teamId: TEAM, keyId: KID, keyFile: join(dir, "missing.p8") })).toBeUndefined();
    const bad = join(dir, "bad.p8");
    writeFileSync(bad, "not a key");
    expect(loadAppleMusic({ teamId: TEAM, keyId: KID, keyFile: bad })).toBeUndefined();
    expect(logs).toEqual(["apple_music=unavailable reason=key_unreadable", "apple_music=unavailable reason=key_unreadable"]);
    expect(logs.join(" ")).not.toContain(dir);
  });

  it("loads a .p8 key into a client", async () => {
    const apple = loadAppleMusic({ teamId: TEAM, keyId: KID, keyFile }, { fetch: (async () => answer([album(1)], [])) as typeof fetch });
    expect(apple).toBeDefined();
    expect(await apple!.search("artist a")).toHaveLength(1);
    expect(logs.join(" ")).not.toContain(readFileSync(keyFile, "utf8").split("\n")[1]!);
  });
});
