import { describe, expect, it } from "vitest";
import {
  AGGREGATORS,
  checkResearchText,
  type ClaimInput,
  EMBARGOED_SEARCH_REFUSAL,
  embargoedSearch,
  judgeClaim,
  LIMITS,
  normalizeValue,
  numberLines,
  parseTracklist,
  publisherOf,
  researchTracks,
  type ResolvedSource,
  sourceSays,
  trackEmbargo,
} from "../src/index";

const S = (host: string, text: string, path = host): ResolvedSource => ({ url: `https://${host}/${path}`, host, title: host, via: "tavily", text });
const date = (sources: ClaimInput["sources"]): ClaimInput => ({ kind: "release-date", text: "It came out on 2026-10-10.", value: "2026-10-10", sources });

describe("publisherOf", () => {
  it("drops www. and m., keeps each bandcamp page whole, and handles two-letter country domains", () => {
    expect(publisherOf("www.discogs.com")).toBe("discogs.com");
    expect(publisherOf("m.youtube.com")).toBe("youtube.com");
    expect(publisherOf("en.wikipedia.org")).toBe("wikipedia.org");
    expect(publisherOf("a.bandcamp.com")).not.toBe(publisherOf("b.bandcamp.com"));
    expect(publisherOf("Example-Label.Bandcamp.com")).toBe("example-label.bandcamp.com");
    expect(publisherOf("news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(publisherOf("pitchfork.com")).toBe("pitchfork.com");
    expect(AGGREGATORS).toContain("daily.bandcamp.com");
  });
});

describe("normalizeValue", () => {
  it("folds labels, reads dates at their precision, and refuses ambiguous numeric dates", () => {
    expect(normalizeValue("label", "Brownswood Recordings")).toBe(normalizeValue("label", "Brownswood"));
    expect(normalizeValue("label", "Ninja Tune Ltd.")).toBe("ninja tune");
    expect(normalizeValue("release-date", "Oct 10 2026")).toBe("2026-10-10");
    expect(normalizeValue("release-date", "October 10, 2026")).toBe("2026-10-10");
    expect(normalizeValue("release-date", "10 October 2026")).toBe("2026-10-10");
    expect(normalizeValue("release-date", "2026-10")).toBe("2026-10");
    expect(normalizeValue("release-date", "2026")).toBe("2026");
    expect(normalizeValue("release-date", "10/10/2026")).toBeNull();
    expect(normalizeValue("credit", "Bénédicte, Jr.")).toBe("benedicte jr");
    expect(normalizeValue("track-number", "Track 03")).toBe("3");
    expect(normalizeValue("length", "4:07")).toBe("4:07");
  });
});

describe("sourceSays", () => {
  it("finds a date in any written form, and a folded value in the text", () => {
    expect(sourceSays("Out everywhere October 10, 2026 via the label.", "release-date", "2026-10-10")).toBe(true);
    expect(sourceSays("Released 2026-10-17.", "release-date", "2026-10-10")).toBe(false);
    expect(sourceSays("Released 10/10/2026.", "release-date", "2026-10-10")).toBe(false);
    expect(sourceSays("Out on Brownswood Recordings.", "label", "Brownswood")).toBe(true);
  });
});

describe("judgeClaim (Review Focus 1 and 2)", () => {
  it("confirms a date shown by two publishers", () => {
    const sources = { S1: S("example-label.bandcamp.com", "Out October 10, 2026"), S2: S("pitchfork.com", "Due October 10, 2026") };
    const j = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), sources);
    expect(j.status).toBe("confirmed");
    expect(j.sources.every((s) => s.matched)).toBe(true);
    expect(j.sources[0]).not.toHaveProperty("text");
  });

  it("does not confirm from two pages of one publisher", () => {
    const sources = { S1: S("www.discogs.com", "2026-10-10", "a"), S2: S("discogs.com", "2026-10-10", "b") };
    const j = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), sources);
    expect(j).toMatchObject({ status: "could-not-verify", check: "Only one source: discogs.com" });
  });

  it("trusts a primary source only when it is not an aggregator", () => {
    const wiki = judgeClaim(date([{ id: "S1", primary: true }]), { S1: S("en.wikipedia.org", "October 10, 2026") });
    expect(wiki.status).toBe("could-not-verify");
    const artist = judgeClaim(date([{ id: "S1", primary: true }]), { S1: S("artist.bandcamp.com", "October 10, 2026") });
    expect(artist.status).toBe("confirmed");
    const unflagged = judgeClaim(date([{ id: "S1" }]), { S1: S("artist.bandcamp.com", "October 10, 2026") });
    expect(unflagged.status).toBe("could-not-verify");
  });

  it("counts two different bandcamp pages and two different aggregators as two publishers (R5)", () => {
    const bc = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: S("a.bandcamp.com", "2026-10-10"), S2: S("b.bandcamp.com", "2026-10-10") });
    expect(bc.status).toBe("confirmed");
    const agg = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: S("discogs.com", "2026-10-10"), S2: S("musicbrainz.org", "2026-10-10") });
    expect(agg.status).toBe("confirmed");
  });

  it("marks a conflict and names both values with their hosts", () => {
    const sources = { S1: S("example.bandcamp.com", "Out 2026-10-10"), S2: S("discogs.com", "Released 2026-10-17") };
    const j = judgeClaim(date([{ id: "S1" }, { id: "S2", says: "2026-10-17" }]), sources);
    expect(j.status).toBe("conflict");
    expect(j.check).toBe("Sources disagree: 2026-10-10 (example.bandcamp.com) vs 2026-10-17 (discogs.com)");
  });

  it("keeps an unmatched source listed but does not count it", () => {
    const j = judgeClaim(date([{ id: "S1" }]), { S1: S("pitchfork.com", "A great record.") });
    expect(j.sources[0]!.matched).toBe(false);
    expect(j).toMatchObject({ status: "could-not-verify", check: "No source shows 2026-10-10" });
  });

  it("gives no partial credit for a year against a full date", () => {
    const sources = { S1: S("a.bandcamp.com", "Released in 2026."), S2: S("pitchfork.com", "Released in 2026.") };
    const j = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), sources);
    expect(j.status).toBe("could-not-verify");
    expect(normalizeValue("release-date", "2026")).not.toBe(normalizeValue("release-date", "2026-10-10"));
    const year = judgeClaim({ ...date([{ id: "S1" }, { id: "S2", says: "2026" }]), value: "2026-10-10" }, { S1: S("a.bandcamp.com", "2026-10-10"), S2: S("pitchfork.com", "2026") });
    expect(year.status).toBe("conflict");
  });

  it("calls a non-critical fact with a source sourced, and with none could-not-verify", () => {
    const bio: ClaimInput = { kind: "bio", text: "A bassist from Detroit.", sources: [{ id: "S1" }] };
    expect(judgeClaim(bio, { S1: S("pitchfork.com", "anything") }).status).toBe("sourced");
    expect(judgeClaim({ ...bio, sources: [] }, {})).toMatchObject({ status: "could-not-verify", check: "No source" });
  });
});

describe("checkResearchText (Review Focus 5)", () => {
  it("refuses talk, links, first or second person in angles, and over-length text", () => {
    expect(checkResearchText("Coming up next, a gem from the label.", "claim")).toMatch(/talk/);
    expect(checkResearchText("You’re listening to a gem.", "intro")).toMatch(/talk/);
    expect(checkResearchText("I love this one", "angle")).toMatch(/person/);
    expect(checkResearchText("What a record!", "angle")).toMatch(/!/);
    expect(checkResearchText("What links this label to the opener?", "angle")).toBeNull();
    expect(checkResearchText("See https://example.org for more.", "replacement")).toMatch(/link/);
    expect(checkResearchText("See www.example.org.", "note")).toMatch(/link/);
    expect(checkResearchText("x".repeat(LIMITS.angle + 1), "angle")).toContain(String(LIMITS.angle));
    expect(checkResearchText("I checked the label page.", "note")).toBeNull();
  });
});

describe("researchTracks", () => {
  it("keys tracks H<hour>.<position> and keeps the closing marks", () => {
    const { tracks } = parseTracklist(`Hour 1\nA - "One"\nB - "Two"\nHour 2\nC - "Three" feat. D\nE - "Four"`);
    const r = researchTracks(tracks);
    expect(r.map((t) => t.key)).toEqual(["H1.1", "H1.2", "H2.1", "H2.2"]);
    expect(r.filter((t) => t.closing).map((t) => t.key)).toEqual(["H1.2", "H2.2"]);
    expect(r[2]).toMatchObject({ artist: "C", title: "Three", feat: "D", hour: 2, position: 1 });
  });
});

describe("numberLines (Review Focus 3)", () => {
  const tracks = [
    { key: "H1.1", hour: 1 as const, position: 1, artist: "Ãrtist A", title: "Title A", closing: false },
    { key: "H1.15", hour: 1 as const, position: 15, artist: "Closer", title: "Last Song", closing: true },
  ];
  const notes = [
    "# Rhythm Lab Radio, Hour One: Show Notes",
    "An intro line.",
    "",
    "## 1. Artist A – \"Title A\"",
    "**Release:** a single.",
    "### Details:",
    "- A fact.",
    "**15. Closer - “Last Song”**",
    "- A line under the closing track.",
    "### Details:",
    "- Another.",
    "## Pre-Air Verify List",
    "- An item.",
  ].join("\n");

  it("numbers each non-empty line, keys lines under a track heading, and marks a closing track's lines", () => {
    const lines = numberLines(notes, tracks);
    expect(lines.map((l) => l.id)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12"]);
    expect(lines[0]).toEqual({ id: "L1", text: "# Rhythm Lab Radio, Hour One: Show Notes", closing: false });
    expect(lines.slice(2, 6).every((l) => l.trackKey === "H1.1" && !l.closing)).toBe(true);
    expect(lines.slice(6, 10).every((l) => l.trackKey === "H1.15" && l.closing)).toBe(true);
    expect(lines.slice(10).every((l) => l.trackKey === undefined && !l.closing)).toBe(true);
  });
});

describe("embargoes in research (R2, R8)", () => {
  const active = [{ artist: "Ãrtist A", title: "Home", until: "2026-11-06" }];
  it("finds a track's embargo with Plan 8's matcher, and a set one wins", () => {
    expect(trackEmbargo({ artist: "Artist A & Friend", title: "Home (Radio Edit)" }, active)).toEqual({ until: "2026-11-06" });
    expect(trackEmbargo({ artist: "Someone", title: "Home" }, active)).toBeUndefined();
    expect(trackEmbargo({ artist: "Someone", title: "Else", embargo: { until: null } }, active)).toEqual({ until: null });
  });
  it("refuses a web search that names an embargoed release, without naming it", () => {
    expect(embargoedSearch("artist a home release date", active)).toBe(true);
    expect(embargoedSearch("Home release date", active)).toBe(true);
    expect(embargoedSearch("artist a biography", active)).toBe(false);
    expect(embargoedSearch("Up release date", [{ artist: "Ãrtist A", title: "Up", until: null }])).toBe(false);
    expect(embargoedSearch("artist a up", [{ artist: "Ãrtist A", title: "Up", until: null }])).toBe(true);
    expect(EMBARGOED_SEARCH_REFUSAL).not.toMatch(/embargo/i);
  });
});
