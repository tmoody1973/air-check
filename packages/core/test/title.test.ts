import { expect, test } from "vitest";
import { buildTitle, checkTags, checkTitleArtists, titleLeads } from "../src/index";
import { goldenPackageTitles, leadsOf } from "./helpers/fixtures";
import { goldenTracks } from "./helpers/goldens";

test("builds the house title pattern", () => {
  expect(buildTitle("2026-10-02", ["Michael Kiwanuka", "Tinashe", "Bicep", "Kaytranada", "Hiatus Kaiyote"])).toBe(
    "RLR 10.2.26 | Michael Kiwanuka, Tinashe, Bicep, Kaytranada, Hiatus Kaiyote and more",
  );
  expect(buildTitle("2026-10-02", ["A", "B", "C", "D"], ":")).toBe("RLR 10.2.26: A, B, C, D and more");
});

test("rejects too few, too many, or too long", () => {
  expect(() => buildTitle("2026-10-02", ["A", "B", "C"])).toThrow(RangeError);
  expect(() => buildTitle("2026-10-02", ["A", "B", "C", "D", "E", "F", "G"])).toThrow(RangeError);
  expect(() => buildTitle("2026-10-02", ["A".repeat(30), "B".repeat(30), "C".repeat(30), "D"])).toThrow(RangeError);
});

test("golden titles and alternates only name artists in the show", () => {
  const titles = goldenPackageTitles();
  expect(titles).toHaveLength(3);
  for (const t of titles) expect(checkTitleArtists(leadsOf(t), goldenTracks())).toEqual([]);
  expect(checkTitleArtists(["Michael Kiwanuka", "Radiohead"], goldenTracks())).toEqual(["Radiohead"]);
});

test("tag rules", () => {
  expect(checkTags(["Jazz", "Electronic", "R&B", "Soul", "Hip Hop"])).toEqual([]);
  expect(checkTags(["Jazz", "jazz", "Soul", "R&B", "Indie", "Electronic"])).toEqual([
    "more than 5 tags",
    "duplicate tag: jazz",
  ]);
  expect(checkTags(["Jazz", " "])).toEqual(["empty tag"]);
});

test("titleLeads reads the leads back out of a built title; [] for any other title", () => {
  const leads = ["Michael Kiwanuka", "Tinashe", "Bicep", "Kaytranada"];
  expect(titleLeads(buildTitle("2026-10-02", leads))).toEqual(leads);
  expect(titleLeads(buildTitle("2026-10-02", leads, ":"))).toEqual(leads);
  expect(titleLeads("Some other title")).toEqual([]);
});
