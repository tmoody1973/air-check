import { describe, expect, it } from "vitest";
import events from "./fixtures/v12-events.json";
import { applyRunEvent, initialRun, stepText } from "../src/runs";

describe("applyRunEvent", () => {
  it("V12 replay yields 2 done steps and cancelled", () => {
    const s = events.reduce(
      (st, e, i) => applyRunEvent(st, e.event, e.data, i * 1000),
      initialRun("r1"),
    );
    expect(s.status).toBe("cancelled");
    expect(s.steps.map((x) => x.status)).toEqual(["done", "done"]);
    expect(s.steps[0]).toMatchObject({ tool: "terminal", preview: "sleep 5 && echo step-1", durationSec: 5.1 });
  });
  it("completed before started is ignored", () => {
    const s0 = initialRun("r1");
    expect(applyRunEvent(s0, "tool.completed", { tool: "terminal" }, 1).steps).toEqual([]);
  });
  it("error flag marks step error", () => {
    let s = applyRunEvent(initialRun("r1"), "tool.started", { tool: "terminal", preview: "x".repeat(100) }, 1);
    expect(s.steps[0]!.preview).toHaveLength(80);
    s = applyRunEvent(s, "tool.completed", { tool: "terminal", error: true }, 2);
    expect(s.steps[0]!.status).toBe("error");
  });
  it("unknown event is a no-op", () => {
    const s = initialRun("r1");
    expect(applyRunEvent(s, "weird", {}, 1)).toBe(s);
  });
  it("state is not mutated", () => {
    const s = Object.freeze(initialRun("r1"));
    const s2 = applyRunEvent(s, "tool.started", { tool: "terminal" }, 1);
    const s3 = applyRunEvent(Object.freeze({ ...s2, steps: Object.freeze(s2.steps.map((x) => Object.freeze(x))) as never }), "tool.completed", { tool: "terminal" }, 2);
    expect(s3.steps[0]!.status).toBe("done");
    expect(applyRunEvent(s, "run.completed", { output: "ok" }, 3)).toMatchObject({ status: "completed", output: "ok" });
  });
  it("leaves display-only label and sources untouched", () => {
    const base = initialRun("r1");
    const withMeta = { ...base, steps: [{ id: "r1-0", tool: "t", preview: "p", status: "working" as const, startedAt: 1, label: "H1.4", sources: ["musicbrainz.org"] }] };
    const s = applyRunEvent(withMeta, "tool.completed", { tool: "t" }, 2);
    expect(s.steps[0]).toMatchObject({ status: "done", label: "H1.4", sources: ["musicbrainz.org"] });
  });
});

describe("stepText", () => {
  const started = (tool: string, preview: string | null = null) => applyRunEvent(initialRun("r1"), "tool.started", { tool, preview }, 1).steps[0]!;
  it.each([
    ["mcp__aircheck__package_get", "Read the package"],
    ["mcp__aircheck__package_revise", "Proposed a new description"],
    ["mcp__aircheck__package_submit", "Submitted the package"],
    ["package_get", "Read the package"],
    ["skill_view", "Read a skill"],
    ["skills_view", "Read a skill"],
    ["mcp__crate__musicbrainz_search_artist", "musicbrainz search artist"],
    ["tool_search", "tool search"],
  ])("a %s step with no search text reads %j", (tool, text) => {
    expect(stepText(started(tool))).toBe(text);
  });
  it("search text wins over the tool name", () => {
    expect(stepText(started("mcp__crate__musicbrainz_search_artist", "Seun Kuti"))).toBe("Seun Kuti");
  });
});
