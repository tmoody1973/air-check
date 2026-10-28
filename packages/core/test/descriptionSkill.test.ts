import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESCRIPTION_SKILL_TEXT } from "../src/index";

const md = readFileSync(fileURLToPath(new URL("../../../skills/rlr-description-safety/SKILL.md", import.meta.url)), "utf8");

describe("DESCRIPTION_SKILL_TEXT", () => {
  it("is the skill's body, without the frontmatter (run `pnpm sync:skills` after editing the skill)", () => {
    const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    expect(DESCRIPTION_SKILL_TEXT).toBe(body);
    expect(DESCRIPTION_SKILL_TEXT).not.toContain("name: rlr-description-safety");
    expect(DESCRIPTION_SKILL_TEXT.startsWith("# Rhythm Lab Radio: the public description")).toBe(true);
  });
});
