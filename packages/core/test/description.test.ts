import { expect, test } from "vitest";
import { checkDescription } from "../src/index";
import { goldenDescription } from "./helpers/fixtures";
import { goldenTitles } from "./helpers/goldens";

const golden = goldenDescription();
const opts = () => ({ trackTitles: goldenTitles(), privateTerms: ["health"] });

test("golden description passes and is under 1,000 characters", () => {
  expect(checkDescription(golden, opts())).toEqual([]);
  expect([...golden].length).toBeLessThan(1000);
});

test("flags time-relative phrases", () => {
  const bad = golden.replace("new soul", "new soul, out TODAY, and the record coming October 23");
  const phrases = checkDescription(bad, opts()).flatMap((i) => (i.kind === "time-relative" ? [i.phrase.toLowerCase()] : []));
  expect(phrases).toEqual(expect.arrayContaining(["out today", "coming october 23"]));
});

test("flags length over 999 code points", () => {
  expect(checkDescription("x".repeat(1000), opts())).toContainEqual({ kind: "too-long", length: 1000 });
  expect(checkDescription("é".repeat(999), opts()).some((i) => i.kind === "too-long")).toBe(false);
});


test("flags a pasted tracklist", () => {
  expect(checkDescription(`${golden} ${goldenTitles().filter((t) => t.length >= 5).slice(0, 6).join(", ")}`, opts()).some((i) => i.kind === "tracklist")).toBe(true);
});

test("flags private terms", () => {
  expect(checkDescription(`${golden} a Health matter`, opts())).toContainEqual({ kind: "private", term: "health" });
});

const tarik =
  "Dive into the show, a rich sonic journey weaving soulful R&B, jazzy grooves, and Afrobeat rhythms. From corto.alto’s smooth “April” featuring anaiis to Sampha’s emotive “Cumulus/Memory,” and Yazmin Lacey’s powerful “Worlds Apart,” the set blends intimate vocals with dynamic beats. Antibalas’s vibrant Afrobeat pulses alongside genre-defying gems by Emma-Jean Thackray and Little Simz, crafting a seamless flow of discovery and depth.";
const titles = ["April", "Cumulus/Memory", "Worlds Apart", "Afrobeat", "dynamic beats", "Little Simz", "seamless flow", "Sampha"];
const o = (trackTitles: string[]) => ({ trackTitles, privateTerms: [] as string[] });

test("Tarik's own style (3 named songs, no opening line) passes", () => {
  expect(checkDescription(tarik, o(titles.slice(0, 3)))).toEqual([]);
});

test("naming 7 of the given titles is a tracklist", () => {
  expect(checkDescription(tarik, o(titles.slice(0, 7))).some((i) => i.kind === "tracklist")).toBe(true);
  expect(checkDescription(tarik, o(titles.slice(0, 6))).some((i) => i.kind === "tracklist")).toBe(true);
  expect(checkDescription(tarik, o(titles.slice(0, 5))).some((i) => i.kind === "tracklist")).toBe(false);
});

test("flags this week's, straight and curly apostrophe, any case", () => {
  for (const t of ["Dive into this week's show.", "Dive into This Week’s show.", "Dive into THIS WEEK'S set."]) {
    expect(checkDescription(t, o([])).some((i) => i.kind === "time-relative")).toBe(true);
  }
});
