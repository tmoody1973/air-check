import { expect, test } from "vitest";
import { formatTrack, formatTracklist, parseDriveTracklist, parseTracklist, tracklistDifference } from "../src/index";
import { readFixture } from "./helpers/fixtures";

test("golden 10-2-26 parses to 15 + 16 with closing tracks", () => {
  const p = parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt"));
  expect(p.bad).toEqual([]);
  expect(p.tracks.filter((t) => t.hour === 1)).toHaveLength(15);
  expect(p.tracks.filter((t) => t.hour === 2)).toHaveLength(16);
  expect(p.tracks.filter((t) => t.closing).map(formatTrack)).toEqual([
    'Channell & 2bfrank - "Just Move"',
    'SW2 vs EL-B - "Nightmare On Bascombe Street"',
  ]);
});

test("splits on spaced dash only", () => {
  const [t] = parseTracklist('HOUR 2\nSW2 vs EL-B - "Nightmare On Bascombe Street"').tracks;
  expect(t!.artist).toBe("SW2 vs EL-B");
});

test("a dash pressed against an opening quote is the separator (real 2025 lines)", () => {
  const p = parseTracklist('HOUR 1\nJames Blake –”Doesn’t Just Happen” feat. Dave\nArtist -"Title"\nSomeone -“Curly”');
  expect(p.bad).toEqual([]);
  expect(p.tracks.map((t) => [t.artist, t.title, t.feat])).toEqual([
    ["James Blake", "Doesn’t Just Happen", "Dave"],
    ["Artist", "Title", undefined],
    ["Someone", "Curly", undefined],
  ]);
});

test("a hyphen inside a word still never splits", () => {
  expect(parseTracklist('HOUR 1\nJay-Z - "Song"').tracks[0]).toMatchObject({ artist: "Jay-Z", title: "Song" });
  expect(parseTracklist('HOUR 1\nLo-Fi Hip-Hop - "Beat"').tracks[0]).toMatchObject({ artist: "Lo-Fi Hip-Hop", title: "Beat" });
  expect(parseTracklist("HOUR 1\nLo-Fi Rapper").bad.map((b) => b.reason)).toEqual(["no-separator"]);
});

test("keeps feat. outside quotes", () => {
  const [t] = parseTracklist('HOUR 1\nResavoir - "4th Cloud" feat. Gregory Uhlmann').tracks;
  expect(t).toMatchObject({ title: "4th Cloud", feat: "Gregory Uhlmann" });
});

test("feat. with quotes inside it", () => {
  const [t] = parseTracklist('HOUR 1\nYour Old Droog - "I Appreciate You" feat. Tarriona "Tank" Ball').tracks;
  expect(t).toMatchObject({ title: "I Appreciate You", feat: 'Tarriona "Tank" Ball' });
});

test("keeps comma in artist", () => {
  const [t] = parseTracklist(`HOUR 1\nWalter Bishop, Jr. - "N'Dugu's Prayer"`).tracks;
  expect(t!.artist).toBe("Walter Bishop, Jr.");
});

test("flags unparseable and pre-hour lines", () => {
  const p = parseTracklist("Intro line\nHOUR 2\nTinashe Sunglasses\nActress - Withending");
  expect(p.bad.map((b) => b.reason)).toEqual(["before-hour-marker", "no-separator"]);
  expect(p.tracks[0]).toMatchObject({ title: "Withending", closing: true });
});

test("closing track skips a bad final line", () => {
  const p = parseTracklist('HOUR 1\nA - "One"\nB - "Two"\nbroken line');
  expect(p.tracks.find((t) => t.closing)?.title).toBe("Two");
  expect(p.bad).toHaveLength(1);
});

test("parses smart quotes, dashes and CRLF", () => {
  const p = parseTracklist(
    "Hour 1\r\nMichael Kiwanuka – “Summer Clothes”  \r\n\tBicep — “Viper” feat. Clark & Saskia\r\n",
  );
  expect(p.tracks.map((t) => [t.artist, t.title, t.feat])).toEqual([
    ["Michael Kiwanuka", "Summer Clothes", undefined],
    ["Bicep", "Viper", "Clark & Saskia"],
  ]);
});

test("accepts hour marker variants", () => {
  for (const m of ["Hour 1", "HOUR ONE", "hour 1 -", "Hour 1:"])
    expect(parseTracklist(`${m}\nA - "B"`).tracks[0]!.hour).toBe(1);
  expect(parseTracklist('Hour 2:\nA - "B"').tracks[0]!.hour).toBe(2);
});

test("a band name starting with # is a track, not a comment", () => {
  const p = parseTracklist('# a comment\nHOUR 1\n#1 Dads - "So Soldier"');
  expect(p.tracks.map((t) => t.artist)).toEqual(["#1 Dads"]);
});

test("formatTracklist writes both hours under Hour headings and parses back to the same tracks", () => {
  const p = parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt"));
  const text = formatTracklist(p.tracks);
  expect(text.startsWith("Hour 1\n")).toBe(true);
  expect(text).toContain("\n\nHour 2\n");
  const back = parseTracklist(text);
  expect(back.bad).toEqual([]);
  expect(back.tracks.map((t) => [t.hour, t.artist, t.title, t.feat, t.closing])).toEqual(p.tracks.map((t) => [t.hour, t.artist, t.title, t.feat, t.closing]));
});

test("parseDriveTracklist: a title line above HOUR 1 is not bad; a track-like line there still is", () => {
  expect(parseDriveTracklist('Rhythm Lab Radio\nHOUR 1\nA - "One"\nHOUR 2\nB - "Two"').bad).toEqual([]);
  expect(parseDriveTracklist('X - "Early"\nHOUR 1\nA - "One"').bad.map((b) => b.reason)).toEqual(["before-hour-marker"]);
});

// R6: the agent must hand back the tracklist it was given; the first difference is named so it can correct itself.
test("tracklistDifference: null when exact; else the first difference, in the order a host reads it", () => {
  const want = parseTracklist('HOUR 1\naja monet - "the black sea"\nB - "Two" feat. C\nHOUR 2\nD - "Four"').tracks;
  const got = (text: string) => tracklistDifference(parseTracklist(text).tracks, want);
  expect(got('Hour 1\naja monet - "the black sea"\nB - "Two" feat. C\n\nHour 2\nD - "Four"')).toBeNull();
  expect(got('HOUR 1\nja monet - "the black sea"\nB - "Two" feat. C\nHOUR 2\nD - "Four"')).toBe(
    `hour 1 track 1 'ja monet - "the black sea"' should be 'aja monet - "the black sea"'`,
  );
  expect(got('HOUR 1\naja monet - "the black sea"\nB - "Two"\nHOUR 2\nD - "Four"')).toBe(`hour 1 track 2 'B - "Two"' should be 'B - "Two" feat. C'`);
  expect(got('HOUR 1\naja monet - "the black sea"\nHOUR 2\nD - "Four"')).toBe(`hour 1 track 2 is missing: it should be 'B - "Two" feat. C'`);
  expect(got('HOUR 1\naja monet - "the black sea"\nB - "Two" feat. C\nHOUR 2\nD - "Four"\nE - "Five"')).toBe(`hour 2 track 2 'E - "Five"' should not be there`);
  expect(got('HOUR 1\nB - "Two" feat. C\naja monet - "the black sea"\nHOUR 2\nD - "Four"')).toMatch(/^hour 1 track 1 /); // order
  expect(got('HOUR 1\naja monet - "the black sea"\nHOUR 2\nB - "Two" feat. C\nD - "Four"')).toMatch(/^hour 1 track 2 is missing/); // hour
});

test("parseDriveTracklist: a pressed-dash track above HOUR 1 is still flagged, not dropped as a title", () => {
  expect(parseDriveTracklist('Artist -"Title"\nHOUR 1\nA - "B"').bad.map((b) => b.raw)).toEqual(['Artist -"Title"']);
});
