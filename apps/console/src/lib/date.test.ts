import { expect, it } from "vitest";
import { chicagoDateLabel, showDateLabel } from "./date";

it("formats the show date with a short month and no leading zero", () => {
  expect(showDateLabel("2026-10-02")).toBe("Oct 2, 2026");
  expect(showDateLabel("2027-01-15")).toBe("Jan 15, 2027");
  expect(showDateLabel("not a date")).toBe("not a date");
});

it("labels an instant by its date in Milwaukee", () => {
  expect(chicagoDateLabel(Date.UTC(2026, 9, 28, 3, 0))).toBe("Oct 27, 2026");
  expect(chicagoDateLabel(Date.UTC(2026, 9, 28, 12, 0))).toBe("Oct 28, 2026");
});
