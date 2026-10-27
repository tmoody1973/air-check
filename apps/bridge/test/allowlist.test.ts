import { describe, expect, it } from "vitest";
import { isAllowedCrateTool } from "../src/allowlist.js";

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
