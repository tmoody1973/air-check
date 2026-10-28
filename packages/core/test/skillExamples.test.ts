import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDescription } from "../src/index";
import { goldenTitles } from "./helpers/goldens";

const skill = readFileSync(
  fileURLToPath(new URL("../../../skills/rlr-description-safety/SKILL.md", import.meta.url)),
  "utf8",
);

/** Every example description in the skill sits in a fenced block tagged `description`. */
const examples = [...skill.matchAll(/^```description\n([\s\S]*?)\n```$/gm)].map((m) => m[1]!);

/** Song titles an example names, in straight or curly quotes, trailing punctuation dropped. */
const namedTitles = (text: string) =>
  [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1]!.replace(/[,.;:]+$/, ""));

describe("rlr-description-safety skill examples", () => {
  it("has Tarik's three examples plus the 10-2-26 example", () => {
    expect(examples).toHaveLength(4);
  });

  it.each(examples.map((text, i) => [i + 1, text] as const))("example %i passes checkDescription", (_, text) => {
    const titles = namedTitles(text);
    expect(titles.length).toBeLessThan(6);
    expect(checkDescription(text, { trackTitles: [...goldenTitles(), ...titles], privateTerms: ["health"] })).toEqual([]);
    expect([...text].length).toBeLessThanOrEqual(999);
  });

  it("the 10-2-26 example names highlight songs from the golden tracklist without pasting it", () => {
    const text = examples.at(-1)!.toLowerCase();
    const named = goldenTitles().filter((t) => t.length >= 5 && text.includes(t.toLowerCase()));
    expect(named.length).toBeGreaterThanOrEqual(4);
    expect(named.length).toBeLessThan(6);
  });

  it("no longer requires the station opening line and keeps its install name", () => {
    expect(skill).not.toMatch(/Rhythm Lab Radio, week of/);
    expect(skill).toMatch(/^---\nname: rlr-description-safety\ndescription: .+\n---/);
  });

  it("keeps the death rule and its narrow tribute-show exception", () => {
    expect(skill).toMatch(/Never mention health, age or death/);
    const exception = skill.split("\n").find((l) => /tribute/i.test(l)) ?? "";
    for (const key of ["tribute", "Never decide on your own", "cause", "age", "descriptionSources", "review flags"])
      expect(exception).toContain(key);
  });
});
