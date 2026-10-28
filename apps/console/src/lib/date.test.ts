import { expect, it } from "vitest";
import { chicagoDateLabel, chicagoTimeLabel, showDateLabel } from "./date";

it("formats the show date with a short month and no leading zero", () => {
  expect(showDateLabel("2026-10-02")).toBe("Oct 2, 2026");
  expect(showDateLabel("2027-01-15")).toBe("Jan 15, 2027");
  expect(showDateLabel("not a date")).toBe("not a date");
});

it("labels an instant by its date in Milwaukee", () => {
  expect(chicagoDateLabel(Date.UTC(2026, 9, 28, 3, 0))).toBe("Oct 27, 2026");
  expect(chicagoDateLabel(Date.UTC(2026, 9, 28, 12, 0))).toBe("Oct 28, 2026");
});

it("adds whole Chicago calendar days, across a month end and the DST change", () => {
  const evening = Date.UTC(2026, 9, 28, 3, 0); // Oct 27, 10 pm in Milwaukee
  expect(chicagoDateLabel(evening, 1)).toBe("Oct 28, 2026");
  expect(chicagoDateLabel(evening, 5)).toBe("Nov 1, 2026");
  expect(chicagoDateLabel(evening, 6)).toBe("Nov 2, 2026");
});

it("a receipt time is the Milwaukee date and clock time", () => {
  expect(chicagoTimeLabel("2026-10-28T03:04:00.000Z")).toMatch(/^Oct 27, 2026, 10:04\sPM$/);
  expect(chicagoTimeLabel("garbage")).toBe("garbage");
});
