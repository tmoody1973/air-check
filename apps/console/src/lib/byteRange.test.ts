import { describe, expect, it } from "vitest";
import { parseRange } from "./byteRange";

describe("parseRange", () => {
  it("no header → the whole file", () => {
    expect(parseRange(null, 100)).toBeNull();
  });

  it.each([
    ["bytes=0-9", { start: 0, end: 9 }],
    ["bytes=10-", { start: 10, end: 99 }],
    ["bytes=90-500", { start: 90, end: 99 }],
    ["bytes=-10", { start: 90, end: 99 }],
    ["bytes=-500", { start: 0, end: 99 }],
    ["bytes=99-99", { start: 99, end: 99 }],
    [" bytes = 5 - 6 ", { start: 5, end: 6 }],
  ])("%s → %o", (header, range) => {
    expect(parseRange(header, 100)).toEqual(range);
  });

  it.each(["bytes=100-", "bytes=100-200", "bytes=-0"])("%s on 100 bytes is unsatisfiable", (header) => {
    expect(parseRange(header, 100)).toBe("unsatisfiable");
  });

  it("any range on an empty file is unsatisfiable", () => {
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });

  // RFC 9110: a Range header we can't use is ignored and the whole file is sent.
  it.each(["items=0-9", "bytes=9-0", "bytes=0-1,5-6", "bytes=-", "bytes=a-b", "bytes=1.5-2", "bytes=0x1-2"])("%s is ignored", (header) => {
    expect(parseRange(header, 100)).toBeNull();
  });
});
