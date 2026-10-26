import { expect, test } from "vitest";
import { assertStation } from "../src/index";

test("allows only 88nine and hyfin", () => {
  expect(assertStation("hyfin")).toBe("hyfin");
  expect(assertStation("88nine")).toBe("88nine");
  for (const s of ["rhythmlab", "RHYTHMLAB", "88Nine ", ""]) expect(() => assertStation(s)).toThrow();
});
