import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESEARCH_SKILL_TEXT } from "../src/index";

const body = (skill: string) =>
  readFileSync(fileURLToPath(new URL(`../../../skills/${skill}/SKILL.md`, import.meta.url)), "utf8")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .trim();

describe("RESEARCH_SKILL_TEXT", () => {
  it("is each research skill's body, without the frontmatter (run `pnpm sync:skills` after editing a skill)", () => {
    expect(RESEARCH_SKILL_TEXT["show-notes"]).toBe(body("rlr-show-notes"));
    expect(RESEARCH_SKILL_TEXT.verify).toBe(body("rlr-pre-air-verify"));
    expect(RESEARCH_SKILL_TEXT["deep-dive"]).toBe(body("rlr-deep-dive"));
    expect(RESEARCH_SKILL_TEXT["show-notes"]).not.toContain("name: rlr-show-notes");
  });

  it("no longer tells the agent to ask about closing tracks or to use Tavily directly", () => {
    for (const text of Object.values(RESEARCH_SKILL_TEXT)) {
      expect(text).not.toMatch(/Tavily|Ask Tarik once/);
      expect(text).toContain("source_search");
    }
    expect(RESEARCH_SKILL_TEXT["show-notes"]).toContain("from your supplied notes, which I did not independently check");
  });
});
