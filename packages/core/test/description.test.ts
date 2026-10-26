import { expect, test } from "vitest";
import { checkDescription } from "../src/index";
import { goldenDescription } from "./helpers/fixtures";
import { goldenTitles } from "./helpers/goldens";

const golden = goldenDescription();
const opts = () => ({ showDate: "2026-10-02", trackTitles: goldenTitles(), privateTerms: ["health"] });

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

test("requires the house first line", () => {
  expect(checkDescription(golden.replace("week of October 2", "week of October 3"), opts())).toContainEqual({
    kind: "first-line",
  });
});

test("flags a pasted tracklist", () => {
  expect(checkDescription(`${golden} Summer Clothes, Withending, Googoo Gaga`, opts()).some((i) => i.kind === "tracklist")).toBe(true);
});

test("flags private terms", () => {
  expect(checkDescription(`${golden} a Health matter`, opts())).toContainEqual({ kind: "private", term: "health" });
});
