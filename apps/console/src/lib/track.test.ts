import type { PackageRecord } from "@aircheck/core";
import { describe, expect, it } from "vitest";
import { trackFor } from "./track";

const rec = (status: PackageRecord["status"], audio: Partial<PackageRecord["draft"]["audio"]> = {}) =>
  ({
    status,
    draft: { id: "pkg-10-2-26", title: "RLR 10.2.26", audio: { hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: "ab".repeat(32), hour1DurationSec: 3612.5, ...audio } },
  }) as PackageRecord;

describe("trackFor", () => {
  it("demo gets the bundled sample with hour 2 at 10 s, never the audio route", () => {
    expect(trackFor("demo", rec("awaiting_review"))).toEqual({ src: "/demo/sample-hour.mp3", title: "RLR 10.2.26", durationSec: 20, hour2AtSec: 10 });
  });

  it("real plays the prepared MP3 through the audio route; hour 2 starts at the hour-1 length", () => {
    for (const status of ["awaiting_review", "approved", "publishing", "failed", "outcome_unknown"] as const) {
      expect(trackFor("real", rec(status))).toEqual({
        src: `/api/audio/pkg-10-2-26?v=${"ab".repeat(6)}`,
        title: "RLR 10.2.26",
        hour2AtSec: 3612.5,
      });
    }
  });

  it("real has no audio before the MP3 exists, or once it may have been cleaned up", () => {
    expect(trackFor("real", rec("preparing_audio", { mp3Sha256: undefined }))).toBeNull();
    expect(trackFor("real", rec("succeeded"))).toBeNull();
    expect(trackFor("real", rec("skipped"))).toBeNull();
  });

  it("no hour-1 length means no hour-2 jump", () => {
    expect(trackFor("real", rec("awaiting_review", { hour1DurationSec: undefined }))).not.toHaveProperty("hour2AtSec");
  });
});
