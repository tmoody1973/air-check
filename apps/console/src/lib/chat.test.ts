import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { chatErrorText, progressLine, stepName } from "./chat";

describe("stepName", () => {
  it.each([
    ["mcp__crate__musicbrainz_search_artist", "Searching MusicBrainz"],
    ["mcp__crate__wikipedia_summary", "Reading Wikipedia"],
    ["mcp__crate__bandcamp_search", "Searching Bandcamp"],
    ["mcp__crate__itunes_lookup", "Searching iTunes"],
    ["mcp__aircheck__package_submit", "Submitting the package"],
    ["mcp__aircheck__package_revise", "Revising the description"],
    ["mcp__aircheck__package_get", "Reading the package"],
    ["something_else", "Working"],
    ["", "Working"],
  ])("%s -> %s", (tool, label) => expect(stepName(tool)).toBe(label));
});

describe("progressLine", () => {
  it("queued waits for the agent", () => expect(progressLine("queued", [])).toBe("Waiting for the agent…"));
  it("running names the latest step and its number", () =>
    expect(progressLine("running", [{ tool: "x" }, { tool: "mcp__crate__musicbrainz_search_artist" }])).toBe("Searching MusicBrainz · step 2"));
  it("running with no steps yet says Working", () => expect(progressLine("running", [])).toBe("Working…"));
  it("finished runs have no line", () => {
    for (const s of ["completed", "failed", "cancelled"] as const) expect(progressLine(s, [])).toBeNull();
  });
});

describe("chatErrorText", () => {
  const err = (code: string) => new ConvexError({ code });
  vi.spyOn(console, "error").mockImplementation(() => {});
  it("maps known codes", () => {
    expect(chatErrorText(err("RATE_LIMITED"))).toBe("Demo limit reached. Your message wasn't sent; try again in a few minutes.");
    expect(chatErrorText(err("INVALID_INPUT"))).toBe("Messages can be up to 8,000 characters.");
    expect(chatErrorText(err("NOT_FOUND"))).toBe("That conversation is gone.");
    expect(chatErrorText(err("UNAUTHENTICATED"))).toBe("Signing you in… try again in a moment.");
  });
  it("falls back for unknown codes, prototype keys and non-Convex errors", () => {
    const generic = "Couldn't send. Please try again.";
    for (const code of ["constructor", "toString", "__proto__"]) expect(chatErrorText(err(code))).toBe(generic);
    expect(chatErrorText(new Error("boom"))).toBe(generic);
    expect(chatErrorText(null)).toBe(generic);
  });
});
