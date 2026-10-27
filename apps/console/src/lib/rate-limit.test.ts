import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows 10 per minute per key, then blocks", () => {
    const allow = createRateLimiter(10, 60_000);
    for (let i = 0; i < 10; i++) expect(allow("1.1.1.1", 0)).toBe(true);
    expect(allow("1.1.1.1", 1000)).toBe(false);
    expect(allow("2.2.2.2", 1000)).toBe(true);
  });

  it("opens again after the window passes", () => {
    const allow = createRateLimiter(1, 60_000);
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 59_999)).toBe(false);
    expect(allow("a", 60_000)).toBe(true);
  });
});

describe("createRateLimiter eviction", () => {
  it("limiter evicts empty keys", () => {
    const allow = createRateLimiter(1, 1000);
    allow("old", 0);
    allow("new", 5000); // sweeps "old" (window empty)
    expect(allow.size()).toBe(1);
  });

  it("never holds more than 10,000 keys", () => {
    const allow = createRateLimiter(1, 60_000);
    for (let i = 0; i < 10_050; i++) allow(`k${i}`, i);
    expect(allow.size()).toBeLessThanOrEqual(10_000);
  });
});
