import { describe, expect, it } from "vitest";
import { trackFor } from "./track";

describe("trackFor", () => {
  it("demo gets the sample with hour 2 at 10 s", () => {
    expect(trackFor("demo", "RLR 10.2.26")).toEqual({ src: "/demo/sample-hour.mp3", title: "RLR 10.2.26", durationSec: 20, hour2AtSec: 10 });
  });
  it("real has no audio yet", () => {
    expect(trackFor("real", "RLR 10.2.26")).toBeNull();
  });
});
