import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILL_CATALOG } from "../src/skills/catalog";

const dir = fileURLToPath(new URL("../../../skills/", import.meta.url));
const install = readFileSync(fileURLToPath(new URL("../../../deploy/hermes/install-skills.sh", import.meta.url)), "utf8");

describe("SKILL_CATALOG (Oct 30: Skills and memory page)", () => {
  it("has every skills/*/SKILL.md, with its text as it is on disk (run pnpm sync:skills after editing one)", () => {
    const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(SKILL_CATALOG.map((s) => s.name)).toEqual(names);
    for (const s of SKILL_CATALOG) {
      const body = readFileSync(`${dir}${s.name}/SKILL.md`, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
      expect(s.text).toBe(body);
      expect(s.description.length).toBeGreaterThan(20);
    }
  });
  it("marks as installed exactly the skills install-skills.sh installs", () => {
    const listed = /SKILLS=\(([^)]*)\)/.exec(install)![1]!.trim().split(/\s+/).sort();
    expect(SKILL_CATALOG.filter((s) => s.installed).map((s) => s.name).sort()).toEqual(listed);
  });
});
