import { describe, expect, it } from "vitest";
import { bearerOk } from "../src/auth.js";

const token = "a".repeat(40);

describe("bearerOk", () => {
  it("accepts the right token", () => expect(bearerOk(`Bearer ${token}`, token)).toBe(true));
  it("refuses a wrong token of the same length", () => expect(bearerOk(`Bearer ${"b".repeat(40)}`, token)).toBe(false));
  it("refuses a missing header", () => expect(bearerOk(undefined, token)).toBe(false));
  it("refuses Basic auth", () => expect(bearerOk(`Basic ${token}`, token)).toBe(false));
  it("refuses a different length", () => expect(bearerOk(`Bearer ${token}x`, token)).toBe(false));
  it("refuses an empty bearer", () => expect(bearerOk("Bearer ", token)).toBe(false));
});
