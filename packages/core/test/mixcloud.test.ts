import { expect, test } from "vitest";
import { toMixcloudFields } from "../src/index";
import { goldenDraft } from "./helpers/goldens";

test("maps the golden package to Mixcloud fields", () => {
  const f = toMixcloudFields(goldenDraft());
  expect(f.name).toBe(goldenDraft().title);
  expect(Object.keys(f).filter((k) => k.startsWith("sections-") && k.endsWith("-artist"))).toHaveLength(31);
  expect(f["sections-3-song"]).toBe("4th Cloud feat. Gregory Uhlmann");
  expect(f["sections-0-artist"]).toBe("Walter Bishop, Jr.");
  expect([f["tags-0-tag"], f["tags-4-tag"]]).toEqual(["Jazz", "Hip Hop"]);
});

test("never sends start times or unlisted", () => {
  expect(Object.keys(toMixcloudFields(goldenDraft())).some((k) => /start_time|unlisted/.test(k))).toBe(false);
});

test("refuses bad tags", () => {
  expect(() => toMixcloudFields(goldenDraft({ tags: ["a", "b", "c", "d", "e", "f"] }))).toThrow(/more than 5 tags/);
});
