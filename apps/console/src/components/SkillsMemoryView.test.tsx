// @vitest-environment jsdom
import { SKILL_CATALOG } from "@aircheck/core";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { SkillsMemoryView, type Learned } from "./SkillsMemoryView";

afterEach(cleanup);

const learned: Learned = {
  counts: { fixes: 2, passes: 1, releaseEdits: 1, researchEdits: 1 },
  fixes: [{ showDate: "2026-10-09", parts: ["Box folder", "hour files"], at: 2 }],
  passes: [{ artist: "Versa", title: "Reset", reason: "Too close to last week", at: 5 }],
  releaseEdits: [{ artist: "Waeys", title: "Decked Out", fields: ["releasedOn"] }],
  researchEdits: [{ label: "Deep dive: Massive Attack", key: "brief", at: 9 }],
};

describe("Skills and memory (Oct 30)", () => {
  it("lists every station skill with its purpose, where it is used, and its full text; installed ones are marked", () => {
    render(<SkillsMemoryView skills={SKILL_CATALOG} learned={learned} workspace="real" />);
    for (const s of SKILL_CATALOG) expect(screen.getByText(s.name)).toBeInTheDocument();
    expect(screen.getAllByText("installed")).toHaveLength(SKILL_CATALOG.filter((s) => s.installed).length);
    expect(screen.getByText(/cannot write or rewrite its own skills/)).toBeInTheDocument();
  });
  it("shows what was learned from Tarik, with counts", () => {
    render(<SkillsMemoryView skills={SKILL_CATALOG} learned={learned} workspace="real" />);
    expect(screen.getByText("2026-10-09: Box folder, hour files")).toBeInTheDocument();
    expect(screen.getByText("Versa – Reset: “Too close to last week”")).toBeInTheDocument();
    expect(screen.getByText("Waeys – Decked Out: release date")).toBeInTheDocument();
    expect(screen.getByText("Deep dive: Massive Attack · brief")).toBeInTheDocument();
    expect(screen.getByText(/On for the station agent/)).toBeInTheDocument();
  });
  it("the demo: memory off, no station fixes", () => {
    render(<SkillsMemoryView skills={SKILL_CATALOG} learned={{ ...learned, fixes: [], counts: { ...learned.counts, fixes: 0 } }} workspace="demo" />);
    expect(screen.getByText(/Off in the demo/)).toBeInTheDocument();
    expect(screen.getByText("The demo has no station shows.")).toBeInTheDocument();
  });
});
