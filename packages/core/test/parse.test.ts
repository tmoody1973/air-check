import { expect, test } from "vitest";
import { formatTrack, parseTracklist } from "../src/index";
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
