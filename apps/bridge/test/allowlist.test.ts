import { describe, expect, it } from "vitest";
import { checkCrateArgs, DENIED_CRATE_TOOLS, isAllowedCrateTool } from "../src/allowlist.js";

describe("isAllowedCrateTool", () => {
  it.each(["musicbrainz_search_artist", "wikipedia_x", "bandcamp_x", "itunes_x"])("allows %s", (name) => {
    expect(isAllowedCrateTool(name)).toBe(true);
  });

  it.each([
    "telegraph_post",
    "tumblr_post",
    "browser_open",
    "whosampled_x",
    "youtube_x",
    "news_x",
    "collection_x",
    "playlist_x",
    "radio_x",
    "discogs_x",
    "musicbrainzx",
    "influencecache_x",
    "MUSICBRAINZ_x",
    "",
  ])("refuses %s", (name) => {
    expect(isAllowedCrateTool(name)).toBe(false);
  });
});

describe("DENIED_CRATE_TOOLS", () => {
  it("hides bandcamp_get_fan_collection although its prefix is allowed (Hard Rule 13)", () => {
    expect(DENIED_CRATE_TOOLS).toContain("bandcamp_get_fan_collection");
    expect(isAllowedCrateTool("bandcamp_get_fan_collection")).toBe(false);
  });

  it.each([
    "bandcamp_get_artist_page",
    "bandcamp_get_album",
    "bandcamp_get_artist_tracks",
    "bandcamp_get_bandcamp_editorial",
  ])("hides %s: enrich by artist and title, never by URL (Hard Rule 5)", (name) => {
    expect(DENIED_CRATE_TOOLS).toContain(name);
    expect(isAllowedCrateTool(name)).toBe(false);
  });

  it.each(["bandcamp_search_bandcamp", "bandcamp_discover_music", "bandcamp_get_tag_info"])("keeps %s", (name) => {
    expect(isAllowedCrateTool(name)).toBe(true);
  });
});

describe("checkCrateArgs", () => {
  it.each([
    { url: "https://artist.bandcamp.com/album/x" },
    { url: "https://bandcamp.com/discover" },
    { url: "https://Artist.Bandcamp.com:443/x" },
    { artist: "Sault", category: "features" },
    { q: "Sault", limit: 5, nested: { ok: true } },
    {},
    undefined,
  ])("allows %j", (args) => {
    expect(checkCrateArgs("bandcamp_search_bandcamp", args)).toBeNull();
  });

  it.each([
    ["http scheme", { url: "http://artist.bandcamp.com" }],
    ["lookalike host", { url: "https://bandcamp.com.evil.com" }],
    ["host in the query only", { url: "https://evil.com/?x=bandcamp.com" }],
    ["metadata address", { url: "https://169.254.169.254/latest/meta-data" }],
    ["credentials", { url: "https://user:pw@artist.bandcamp.com" }],
    ["explicit port", { url: "https://artist.bandcamp.com:8443" }],
    ["unparseable url", { url: "artist.bandcamp.com/album/x" }],
    ["non-string url", { url: 42 }],
    ["url hidden in another field", { query: "Sault https://evil.com" }],
    ["url nested in an array", { urls: ["https://evil.com"] }],
    ["other scheme", { q: "file:///etc/passwd" }],
  ])("refuses %s without echoing the URL", (_label, args) => {
    const reason = checkCrateArgs("bandcamp_search_bandcamp", args);
    expect(reason).toBeTypeOf("string");
    expect(reason).not.toMatch(/evil|169\.254|8443|user:pw|passwd/);
  });
});
