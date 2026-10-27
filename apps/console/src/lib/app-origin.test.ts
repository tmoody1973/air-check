import { afterEach, describe, expect, it } from "vitest";
import { appOrigin } from "./app-origin";

const orig = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  if (orig === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = orig;
});

describe("appOrigin", () => {
  it.each([
    ["https://aircheck.rhythmlabradio.com", "https://aircheck.rhythmlabradio.com"],
    ["https://aircheck.rhythmlabradio.com/", "https://aircheck.rhythmlabradio.com"],
    ["https://aircheck.rhythmlabradio.com/today?x=1", "https://aircheck.rhythmlabradio.com"],
  ])("normalizes %s", (input, out) => {
    process.env.NEXT_PUBLIC_APP_URL = input;
    expect(appOrigin()).toBe(out);
  });
  it("is undefined when unset, empty or garbage", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appOrigin()).toBeUndefined();
    process.env.NEXT_PUBLIC_APP_URL = "";
    expect(appOrigin()).toBeUndefined();
    process.env.NEXT_PUBLIC_APP_URL = "not a url";
    expect(appOrigin()).toBeUndefined();
  });
});
