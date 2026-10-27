import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyRunEvent, initialRun } from "../src/runs";

// Captured from a real Hermes run on 2026-10-27 (spikes/v4-bridge/run.py): MusicBrainz
// lookup through the Crate bridge, then package_submit. Pins the live event field names.
const events = readFileSync(new URL("./fixtures/hermes-run-events.ndjson", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as { t: number; event: string; data: Record<string, unknown> });

describe("live Hermes run replay", () => {
  const state = events.reduce((s, e) => applyRunEvent(s, e.event, e.data, e.t * 1000), initialRun("live"));

  it("makes one step per tool.started, all done", () => {
    const started = events.filter((e) => e.event === "tool.started").map((e) => e.data.tool);
    expect(state.steps.map((s) => s.tool)).toEqual(started);
    expect(state.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("reads tool, preview and duration from the real field names", () => {
    const mb = state.steps.find((s) => s.tool === "mcp__crate__musicbrainz_search_artist");
    expect(mb?.preview).toBe("Seun Kuti");
    expect(mb?.durationSec).toBeGreaterThan(0);
    expect(state.steps.some((s) => s.tool === "mcp__aircheck__package_submit")).toBe(true);
  });

  it("ends completed with the run output", () => {
    expect(state.status).toBe("completed");
    expect(state.output).toContain("pkg-10-9-26");
  });
});
