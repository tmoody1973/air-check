import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));

export function readFixture(rel: string): string {
  return readFileSync(root + rel, "utf8");
}
