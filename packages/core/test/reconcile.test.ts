import { expect, test } from "vitest";
import { formatTrack, parseTracklist, reconcile } from "../src/index";
import { goldenLines, readFixture, readPaper } from "./helpers/fixtures";

const drive = () => parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt"));
const paper = () => readPaper("raw/10-2-26-paper-tracks.txt");

test("golden: 31 tracks, both closing, Paper spellings, no questions", () => {
  const r = reconcile(drive(), paper());
  expect(r.tracks).toHaveLength(31);
  expect(r.tracks.filter((t) => t.status === "closing-track")).toHaveLength(2);
  expect(r.questions).toEqual([]);
  const titles = r.tracks.map(formatTrack);
  for (const s of [
    'Saigon Soul Revival - "Lý Qua Dub"',
    'Hermanos Gutiérrez - "Los Ojos Del Cóndor"',
    'Charlotte Adigéry & Bolis Pupul - "Googoo Gaga"',
    `Thee Sinseers & Joey Quiñones - "Let's Fall In Love (Again)"`,
  ])
    expect(titles).toContain(s);
});

test("golden output equals fixture section 5 line for line", () => {
  expect(goldenLines()).toHaveLength(31);
  expect(reconcile(drive(), paper()).tracks.map(formatTrack)).toEqual(goldenLines());
});

test("keeps repeated artist", () => {
  const r = reconcile(parseTracklist('HOUR 2\nTinashe - "Twentyfive Eight"\nTinashe - "Sunglasses"\nX - "Close"'), [
    { hour: 2, artist: "Tinashe", title: "Twentyfive Eight" },
    { hour: 2, artist: "Tinashe", title: "Sunglasses" },
  ]);
  expect(r.tracks.map((t) => t.title)).toEqual(["Twentyfive Eight", "Sunglasses", "Close"]);
});

test("extra non-closing track is kept and asked about", () => {
  const r = reconcile(parseTracklist('HOUR 1\nA - "One"\nB - "Two"\nC - "Three"'), [
    { hour: 1, artist: "B", title: "Two" },
  ]);
  expect(r.tracks.map((t) => t.status)).toEqual(["unverified-in-notes", "confirmed", "closing-track"]);
  expect(r.questions).toHaveLength(1);
});

test("paper-only track is never added", () => {
  const r = reconcile(parseTracklist('HOUR 1\nA - "One"'), [{ hour: 1, artist: "Z", title: "Ghost" }]);
  expect(r.tracks).toHaveLength(1);
  expect(r.questions[0]).toContain("Ghost");
});
