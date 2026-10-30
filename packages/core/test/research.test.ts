import { describe, expect, it } from "vitest";
import {
  AGGREGATORS,
  checkResearchText,
  type ClaimInput,
  EMBARGOED_SEARCH_REFUSAL,
  embargoedSearch,
  firstSearchQuery,
  judgeClaim,
  LIMITS,
  normalize,
  normalizeValue,
  numberLines,
  researchInput,
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
    expect(publisherOf("www.discogs.com.")).toBe("discogs.com");
    for (const a of ["youtu.be", "bandcamp.com", "soundcloud.com", "qobuz.com", "beatport.com"]) expect(AGGREGATORS).toContain(a);
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
    expect(normalizeValue("length", "4:07")).toBe("247"); // seconds, so ms, seconds and m:ss compare
  });

  it("reads ISO timestamps at day precision and ordinal days, and refuses impossible dates (R7)", () => {
    expect(normalizeValue("release-date", "2026-10-10T00:00Z")).toBe("2026-10-10");
    expect(normalizeValue("release-date", "2026-10-10T08:30:00+02:00")).toBe("2026-10-10");
    expect(normalizeValue("release-date", "10th October 2026")).toBe("2026-10-10");
    expect(normalizeValue("release-date", "2026-02-31")).toBeNull();
    expect(normalizeValue("release-date", "February 31, 2026")).toBeNull();
    expect(sourceSays("Published 2026-10-10T00:00:00Z", "release-date", "2026-10-10")).toBe(true);
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

// Oct 29 live run: "No source shows 4:29 / 2 / Ninja Tune" against MusicBrainz text that held all three.
describe("sourceSays reads the forms sources write values in (Oct 29 false negatives)", () => {
  it("a length matches milliseconds, seconds, m:ss and words, within one second", () => {
    expect(sourceSays('{"position":2,"number":"2","title":"Glue","length":269000}', "length", "4:29")).toBe(true);
    expect(sourceSays('{"title":"Glue","length":268450}', "length", "4:29")).toBe(true); // 268.45 s
    expect(sourceSays('{"trackTimeMillis":269999}', "length", "4:29")).toBe(true);
    expect(sourceSays('{"duration":269}', "length", "4:29")).toBe(true); // a duration field in seconds
    expect(sourceSays("It runs 4 minutes and 29 seconds.", "length", "4:29")).toBe(true);
    expect(sourceSays("Glue runs 4:29.", "length", "4 minutes and 29 seconds")).toBe(true);
    expect(sourceSays("Glue runs 4:29.", "length", "269 seconds")).toBe(true);
    expect(sourceSays("Glue runs 4:29.", "length", "269000")).toBe(true); // a value written in milliseconds
    expect(sourceSays("Side two closes on a 1:04:29 jam.", "length", "1:04:29")).toBe(true);
    expect(sourceSays('{"length":271500}', "length", "4:29")).toBe(false); // 2.5 s off
    expect(sourceSays("Glue runs 4:31.", "length", "4:29")).toBe(false);
    expect(sourceSays("Glue has 269 plays and 269000 views.", "length", "4:29")).toBe(false); // a bare number is no length
    expect(normalizeValue("length", "4:29")).toBe("269");
    expect(normalizeValue("length", "a while")).toBeNull();
  });

  it("a track number matches MusicBrainz's position and number fields; a label its label-info name", () => {
    expect(sourceSays('{"position":2,"number":"A2","title":"Glue","length":269000}', "track-number", "2")).toBe(true);
    expect(sourceSays('{"position":3,"number":"3","title":"Glue"}', "track-number", "2")).toBe(false);
    const labelInfo = '{"label-info":[{"catalog-number":"ZEN243","label":{"id":"x","name":"Ninja Tune","sort-name":"Ninja Tune","label-code":12666}}]}';
    expect(sourceSays(labelInfo, "label", "Ninja Tune")).toBe(true);
    expect(sourceSays(labelInfo, "label", "Warp Records")).toBe(false);
  });

  it("'2 November 2017', '2017-11-02' and 'November 2, 2017' match each other", () => {
    const forms = ["2 November 2017", "2017-11-02", "November 2, 2017", "Nov. 2nd, 2017", '"date":"2017-11-02"'];
    for (const text of forms) for (const value of forms.slice(0, 3)) expect(sourceSays(`Glue: ${text}.`, "release-date", value), `${value} in ${text}`).toBe(true);
    expect(sourceSays("Glue: 3 August 2017.", "release-date", "2 November 2017")).toBe(false);
  });
});

describe("sourceSays near the track (Oct 29: 8,000-character page text)", () => {
  const near = ["Alfa Mist", "Organic Rust"];
  const filler = (n: number) => "Other records in the catalog. ".repeat(Math.ceil(n / 30)).slice(0, n);
  it("on a long page a value counts only within 300 characters of the artist or title", () => {
    const far = `Alfa Mist discography. ${filler(2_500)} Some other album came out October 10, 2026 on Label B.`;
    expect(far.length).toBeGreaterThan(2_000);
    expect(sourceSays(far, "release-date", "2026-10-10", near)).toBe(false);
    expect(sourceSays(far, "label", "Label B", near)).toBe(false);
    const close = `${filler(2_500)} Organic Rust is out October 10, 2026 on Label A. ${filler(1_000)}`;
    expect(sourceSays(close, "release-date", "2026-10-10", near)).toBe(true);
    expect(sourceSays(close, "label", "Label A", near)).toBe(true);
    const after = `${filler(2_500)} Out October 10, 2026: ${"x".repeat(250)} the new one from ALFA MIST. ${filler(500)}`;
    expect(sourceSays(after, "release-date", "2026-10-10", near)).toBe(true); // before the mention counts too, folded
  });
  it("a long page that never names the track shows nothing; a short text is read whole, as before", () => {
    expect(sourceSays(`${filler(2_500)} Out October 10, 2026.`, "release-date", "2026-10-10", near)).toBe(false);
    expect(sourceSays(`${filler(1_500)} Out October 10, 2026.`, "release-date", "2026-10-10", near)).toBe(true);
    expect(sourceSays(`${filler(2_500)} Out October 10, 2026.`, "release-date", "2026-10-10")).toBe(true); // no names given
  });
  it("stays linear on a long page full of mentions", { timeout: 30_000 }, () => {
    const page = "Alfa Mist ".repeat(800);
    expect(fastest(() => sourceSays(page, "label", "Label A", near))).toBeLessThan(200);
  });
  it("two long pages that show the date only by coincidence, far from the track, do not confirm it", () => {
    const page = `Alfa Mist. ${filler(2_500)} Unrelated reissue out October 10, 2026.`;
    const sources = { S1: S("pitchfork.com", page), S2: S("stereogum.com", page) };
    const j = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), sources, near);
    expect(j.status).toBe("could-not-verify");
    expect(j.sources.every((s) => !s.matched)).toBe(true);
    const right = `${filler(2_500)} Alfa Mist's Organic Rust arrives October 10, 2026.`;
    expect(judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: S("pitchfork.com", right), S2: S("stereogum.com", right) }, near).status).toBe("confirmed");
  });
  it("a year-only date needs its month near the track too", () => {
    const page = `${filler(2_500)} Organic Rust (2026). ${filler(1_000)} Some tour dates: October 3, 2026.`;
    const year = { kind: "release-date" as const, text: "It came out in 2026.", value: "2026", sources: [{ id: "S1" }, { id: "S2" }] };
    expect(judgeClaim(year, { S1: S("a.com", page), S2: S("b.com", page) }, near)).toMatchObject({ status: "could-not-verify", check: "Only the year 2026 is shown; check the full date" });
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

  it("R8b/R8c: a Crate source off its family's own domains counts as the family's one publisher, never primary", () => {
    const crate = (host: string, family: string, path = host) => ({ ...S(host, "Released 2026-10-10", path), via: `crate:${family}_search` });
    const itunes = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: crate("music.apple.com", "itunes"), S2: crate("is1-ssl.mzstatic.com", "itunes") });
    expect(itunes).toMatchObject({ status: "could-not-verify", check: "Only one source: apple.com" });
    const wikiLink = judgeClaim(date([{ id: "S1", primary: true }]), { S1: crate("label.example", "wikipedia") });
    expect(wikiLink).toMatchObject({ status: "could-not-verify", check: "Only one source: wikipedia.org" });
    const offPlusWiki = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: crate("label.example", "wikipedia"), S2: crate("en.wikipedia.org", "wikipedia") });
    expect(offPlusWiki.status).toBe("could-not-verify");
    // R8c: inside the family's own domains the normal rules apply (Review Focus 2, R5).
    const bc = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: crate("a.bandcamp.com", "bandcamp"), S2: crate("b.bandcamp.com", "bandcamp") });
    expect(bc.status).toBe("confirmed");
    const ownPage = judgeClaim(date([{ id: "S1", primary: true }]), { S1: crate("artist.bandcamp.com", "bandcamp") });
    expect(ownPage.status).toBe("confirmed");
    const mbAndWeb = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: crate("musicbrainz.org", "musicbrainz"), S2: S("musicbrainz.org", "2026-10-10", "x") });
    expect(mbAndWeb.status).toBe("could-not-verify");
    const twoFamilies = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: crate("musicbrainz.org", "musicbrainz"), S2: crate("en.wikipedia.org", "wikipedia") });
    expect(twoFamilies.status).toBe("confirmed"); // R5: two different aggregators
  });

  it("R6: every Apple page is one publisher, apple.com, never primary, whether Apple Music or Crate's iTunes found it", () => {
    const line = 'Apple Music: "Album A" by Artist A · released 2026-10-10 · label Label A · ℗ 2026 Label A';
    const apple = (path: string) => ({ ...S("music.apple.com", line, path), via: "apple_music" });
    const itunes = (host: string, path: string) => ({ ...S(host, "Released 2026-10-10", path), via: "crate:itunes_search" });
    expect(publisherOf("music.apple.com")).toBe("apple.com");
    expect(AGGREGATORS).toContain("apple.com");
    // The same album via both paths (different URLs, so two ledger ids) is still one publisher.
    const both = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: apple("us/album/album-a/1"), S2: itunes("music.apple.com", "us/album/album-a/1?uo=4") });
    expect(both).toMatchObject({ status: "could-not-verify", check: "Only one source: apple.com" });
    const oldStore = judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: apple("a"), S2: itunes("itunes.apple.com", "b") });
    expect(oldStore).toMatchObject({ status: "could-not-verify", check: "Only one source: apple.com" });
    // The ℗ line is Apple's copy of the label's statement, not the label's own page: never primary.
    expect(judgeClaim(date([{ id: "S1", primary: true }]), { S1: apple("a") }).status).toBe("could-not-verify");
    const label: ClaimInput = { kind: "label", text: "It is on Label A.", value: "Label A", sources: [{ id: "S1", primary: true }] };
    expect(judgeClaim(label, { S1: apple("a") }).status).toBe("could-not-verify");
    // One other publisher makes two (R5).
    expect(judgeClaim(date([{ id: "S1" }, { id: "S2" }]), { S1: apple("a"), S2: S("label.example", "Out 2026-10-10") }).status).toBe("confirmed");
    // A year-only ℗ line never confirms a date (R7.6).
    const yearOnly = { ...S("music.apple.com", "Apple Music: \"Album A\" · ℗ 2026 Label A", "c"), via: "apple_music" };
    const year: ClaimInput = { ...date([{ id: "S1" }, { id: "S2" }]), value: "2026" };
    expect(judgeClaim(year, { S1: yearOnly, S2: S("label.example", "© 2026") }).status).toBe("could-not-verify");
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

  it("never confirms a year alone unless a source shows at least the month (R7)", () => {
    const year = (a: string, b: string) => judgeClaim({ ...date([{ id: "S1" }, { id: "S2" }]), value: "2026" }, { S1: S("a.bandcamp.com", a), S2: S("pitchfork.com", b) });
    expect(year("Released in 2026.", "A 2026 record.")).toMatchObject({ status: "could-not-verify", check: "Only the year 2026 is shown; check the full date" });
    expect(year("Out October 10, 2026.", "A 2026 record.").status).toBe("confirmed");
  });

  it("calls a non-critical fact with a source sourced, and with none could-not-verify", () => {
    const bio: ClaimInput = { kind: "bio", text: "A bassist from Detroit.", sources: [{ id: "S1" }] };
    expect(judgeClaim(bio, { S1: S("pitchfork.com", "anything") }).status).toBe("sourced");
    expect(judgeClaim({ ...bio, sources: [] }, {})).toMatchObject({ status: "could-not-verify", check: "No source found.", sources: [] });
  });

  it("Oct 29 (Tarik): a fact with no source at all is kept as could-not-verify, 'No source found.', whatever its kind", () => {
    expect(judgeClaim(date([]), {})).toMatchObject({ status: "could-not-verify", check: "No source found.", value: "2026-10-10" });
    expect(judgeClaim({ kind: "detail", text: "It was a DJ Mag track of the year.", sources: [] }, {})).toMatchObject({ status: "could-not-verify", check: "No source found." });
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
    for (const talk of ["Next up, a deep cut.", "Tune in for the second hour.", "Stick around for this one."]) expect(checkResearchText(talk, "claim")).toMatch(/talk/);
    expect(checkResearchText("Details at example.org/press/release.", "claim")).toMatch(/link/);
    expect(checkResearchText("Released on Ninja Tune.", "claim")).toBeNull();
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

describe("numberLines fails closed (round 1)", () => {
  const tracks = [
    { key: "H1.1", hour: 1 as const, position: 1, artist: "Alpha", title: "One", closing: false },
    { key: "H1.2", hour: 1 as const, position: 2, artist: "Beta", title: "Don't Stop", closing: true },
  ];
  const keyed = (heading: string) => numberLines(`## 1. Alpha – "One"\n- a fact\n${heading}\n- under it`, tracks).slice(2);
  it.each(["## 2. Beta – 'Don't Stop'", '2) Beta – "Don’t Stop"', '2. Beta: "Don\'t Stop"', "**2. Beta – Don't Stop**", "2. Beta Don't Stop"])("keys %s as the closing track", (heading) => {
    expect(keyed(heading)).toEqual([
      { id: "L3", text: heading, trackKey: "H1.2", closing: true },
      { id: "L4", text: "- under it", trackKey: "H1.2", closing: true },
    ]);
  });
  it("never lets a numbered heading for an unknown track inherit the previous key", () => {
    expect(keyed('## 9. Gamma – "Nope"')).toEqual([
      { id: "L3", text: '## 9. Gamma – "Nope"', closing: false },
      { id: "L4", text: "- under it", closing: false },
    ]);
  });
  it("keeps a plain numbered list inside a track", () => {
    expect(keyed("1. Recorded in one take.").every((l) => l.trackKey === "H1.1")).toBe(true);
  });
});

const fastest = (f: () => unknown) =>
  Math.min(...[0, 1, 2].map(() => {
    const t = performance.now();
    f();
    return performance.now() - t;
  }));

describe("untrusted text stays linear (round 1)", () => {
  const hostile = `a${" ".repeat(200_000)}b`;
  const active = [{ artist: "Ãrtist A", title: "Home", until: null }];
  it("normalizes and screens a 200k-character whitespace run fast", { timeout: 30_000 }, () => {
    expect(fastest(() => normalize(hostile))).toBeLessThan(200);
    expect(fastest(() => embargoedSearch(hostile, []))).toBeLessThan(200);
    expect(fastest(() => embargoedSearch(hostile, active))).toBeLessThan(200);
  });
  it("builds a verify prompt over a 200k-character line fast", { timeout: 30_000 }, () => {
    const lines = numberLines(`1. ${hostile}`, []);
    const job = { jobId: "rj-big001", kind: "verify" as const, lines, embargoes: active, angles: true, searchesLeft: 1 };
    expect(fastest(() => researchInput(job))).toBeLessThan(200);
    expect(fastest(() => researchInput({ ...job, embargoes: [] }))).toBeLessThan(200);
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
    // Task 1 carry: a feat. clause in the query must not hide the words after it.
    expect(embargoedSearch("Artist A feat. B Up label", [{ artist: "Ãrtist A", title: "Up", until: null }])).toBe(true);
    expect(EMBARGOED_SEARCH_REFUSAL).not.toMatch(/embargo/i);
  });
});

describe("firstSearchQuery (Oct 29 prefetch)", () => {
  it("is Tarik's query, exactly as the skill writes it", () => {
    expect(firstSearchQuery({ artist: "Bicep", title: "Glue" })).toBe('Tell me about this artist and release Bicep - "Glue"');
  });
});
