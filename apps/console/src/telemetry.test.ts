import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const consoleDir = resolve(__dirname, "..");
const repoRoot = resolve(consoleDir, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("telemetry stays off (Hard Rule 8)", () => {
  const flags = ["NEXT_TELEMETRY_DISABLED=1", "CLERK_TELEMETRY_DISABLED=1"];
  for (const [label, path] of [
    [".env.example", join(consoleDir, ".env.example")],
    ["ci.yml", join(repoRoot, ".github/workflows/ci.yml")],
    ["deploy/Dockerfile", join(repoRoot, "deploy/Dockerfile")],
    ["deploy/console.env.example", join(repoRoot, "deploy/console.env.example")],
  ] as const) {
    it(`${label} disables Next and Clerk telemetry`, () => {
      const text = readFileSync(path, "utf8");
      for (const f of flags) expect(text).toContain(f);
    });
  }

  it("console source imports no analytics package", () => {
    const banned = /gtag|posthog|segment|plausible|@vercel\/analytics|@next\/third-parties/i;
    const files = walk(join(consoleDir, "src")).filter(
      (f) => /\.(ts|tsx|js|jsx|css)$/.test(f) && !f.endsWith("telemetry.test.ts"),
    );
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(banned);
  });
});
