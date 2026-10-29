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

test("unreadable lines become questions", () => {
  const r = reconcile(parseTracklist('HOUR 1\nA - "One"\nB - "Two"\nC–Three'), [
    { hour: 1, artist: "A", title: "One" },
  ]);
  expect(r.questions.some((q) => q.includes("C–Three"))).toBe(true);
});

test("Paper's spelling wins only to restore accents or up to 2 dropped characters; never case, punctuation style or added words (4-17-26)", () => {
  const d = parseTracklist([
    "HOUR 1",
    'Roy Ayers - "Red, Black & Green"',
    'Leikeli 47 - "starlight"',
    'Funk Factory - "Rien Ne Va Plus"',
    'Jalen Ngonda - "Hang it On The Shelf"',
    'Saigon Soul Revival - "Ly Qua Dub"',
    'Hermanos Gutierrez - "Los Ojos Del Cndor"',
    'Closer - "End"',
    "HOUR 2",
    'Lisa Lisa & Cult Jam - "Let The Beat Hit ‘Em"',
    'Closer - "Two"',
  ].join("\n"));
  const p = [
    { hour: 1 as const, artist: "ROY AYERS", title: "Red, Black & Green" },
    { hour: 1 as const, artist: "LEIKELI47", title: "starlight" },
    { hour: 1 as const, artist: "Funk Factory (Michał Urbaniak)", title: "Rien Ne Va Plus" },
    { hour: 1 as const, artist: "JALEN NGONDA", title: "Hang It On The Shelf" },
    { hour: 1 as const, artist: "Saigon Soul Revival", title: "Lý Qua Dub" },
    { hour: 1 as const, artist: "Hermanos Gutiérrez", title: "Los Ojos Del Cóndor" },
    { hour: 2 as const, artist: "LISA LISA & CULT JAM", title: "Let The Beat Hit 'Em" },
  ];
  const r = reconcile(d, p);
  expect(r.tracks.map((t) => [formatTrack(t), t.status])).toEqual([
    ['Roy Ayers - "Red, Black & Green"', "confirmed"],
    ['Leikeli 47 - "starlight"', "confirmed"],
    ['Funk Factory - "Rien Ne Va Plus"', "confirmed"],
    ['Jalen Ngonda - "Hang it On The Shelf"', "confirmed"],
    ['Saigon Soul Revival - "Lý Qua Dub"', "spelling-fixed"],
    ['Hermanos Gutiérrez - "Los Ojos Del Cóndor"', "spelling-fixed"],
    ['Closer - "End"', "closing-track"],
    ['Lisa Lisa & Cult Jam - "Let The Beat Hit ‘Em"', "confirmed"],
    ['Closer - "Two"', "closing-track"],
  ]);
});
