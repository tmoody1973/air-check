import { expect, test } from "vitest";
import { digestCutoff } from "./cutoff";

const iso = (ms: number) => new Date(ms).toISOString();

test("cutoff is 18:00 Chicago the previous day (CDT, summer)", () => {
  expect(iso(digestCutoff(Date.parse("2026-10-26T12:00:00Z")))).toBe("2026-10-25T23:00:00.000Z"); // Oct 25 18:00 CDT
});

test("DST ends Nov 1 2026: Nov 2 03:00 CST -> Nov 1 18:00 CST", () => {
  expect(iso(digestCutoff(Date.parse("2026-11-02T09:00:00Z")))).toBe("2026-11-02T00:00:00.000Z");
});

test("DST ends Nov 1 2026: Nov 1 03:00 CST -> Oct 31 18:00 CDT", () => {
  expect(iso(digestCutoff(Date.parse("2026-11-01T09:00:00Z")))).toBe("2026-10-31T23:00:00.000Z");
});

test("DST starts Mar 8 2026: Mar 9 03:00 CDT -> Mar 8 18:00 CDT", () => {
  expect(iso(digestCutoff(Date.parse("2026-03-09T08:00:00Z")))).toBe("2026-03-08T23:00:00.000Z");
});

test("just after local midnight still uses the previous Chicago day", () => {
  expect(iso(digestCutoff(Date.parse("2026-10-26T05:30:00Z")))).toBe("2026-10-25T23:00:00.000Z");
});
