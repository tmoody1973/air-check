import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";
import { createRateLimiter } from "./rate-limit";

describe("clientIp", () => {
  it("returns trimmed x-real-ip, else unknown", () => {
    expect(clientIp(new Headers({ "x-real-ip": " 9.9.9.9 " }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("limiter ignores client-sent forwarded-for", () => {
    const allow = createRateLimiter(1, 60_000);
    const a = new Headers({ "x-real-ip": "5.5.5.5", "x-forwarded-for": "1.1.1.1" });
    const b = new Headers({ "x-real-ip": "5.5.5.5", "x-forwarded-for": "2.2.2.2" });
    expect(allow(clientIp(a), 0)).toBe(true);
    expect(allow(clientIp(b), 1)).toBe(false);
  });
});
