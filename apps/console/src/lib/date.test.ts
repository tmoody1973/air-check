import { expect, it } from "vitest";
import { showDateLabel } from "./date";

it("formats the show date with a short month and no leading zero", () => {
  expect(showDateLabel("2026-10-02")).toBe("Oct 2, 2026");
  expect(showDateLabel("2027-01-15")).toBe("Jan 15, 2027");
  expect(showDateLabel("not a date")).toBe("not a date");
});
