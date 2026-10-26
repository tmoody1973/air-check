import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { findBoundaryViolations, type SourceFile } from "../packages/core/src/index";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", ".superpowers", "dist"]);
const SCAN = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|py|sh|toml)$|\.env\.example$/;

function walk(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(full);
    if (!SCAN.test(e.name)) return [];
    return [{ path: relative(ROOT, full).split("\\").join("/"), content: readFileSync(full, "utf8") }];
  });
}

test("the repo has no boundary violations", () => {
  const files = walk(ROOT);
  expect(files.length).toBeGreaterThan(10);
  expect(findBoundaryViolations(files)).toEqual([]);
});
