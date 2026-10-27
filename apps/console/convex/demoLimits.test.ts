import { describe, expect, test } from "vitest";
import { chicagoDayStart } from "./demoLimits";

const z = (s: string) => Date.parse(s);

describe("chicagoDayStart", () => {
  test("rolls over at Chicago midnight (CDT)", () => {
    expect(chicagoDayStart(z("2026-10-28T04:59:59.999Z"))).toBe(z("2026-10-27T05:00:00Z"));
    expect(chicagoDayStart(z("2026-10-28T05:00:00Z"))).toBe(z("2026-10-28T05:00:00Z"));
  });
  test("winter offset (CST)", () => {
    expect(chicagoDayStart(z("2026-12-15T12:00:00Z"))).toBe(z("2026-12-15T06:00:00Z"));
  });
  test("DST end (25-hour day) and DST start (23-hour day)", () => {
    expect(chicagoDayStart(z("2026-11-01T12:00:00Z"))).toBe(z("2026-11-01T05:00:00Z"));
    expect(chicagoDayStart(z("2026-03-08T15:00:00Z"))).toBe(z("2026-03-08T06:00:00Z"));
  });
});
