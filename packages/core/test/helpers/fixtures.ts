import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));

export function readFixture(rel: string): string {
  return readFileSync(root + rel, "utf8");
}

export function readPaper(rel: string): { hour: 1 | 2; artist: string; title: string }[] {
  return readFixture(rel)
    .split("\n")
    .filter((l) => /^H[12] \|/.test(l))
    .map((l) => {
      const [h, artist, title] = l.split(" | ");
      return { hour: h === "H1" ? 1 : 2, artist: artist!, title: title!.trim() };
    });
}

/** The 31 tracklist lines from section 5 of the golden package fixture, "(closing track)" stripped. */
export function goldenLines(): string[] {
  const doc = readFixture("RLR-10-2-26-mixcloud-package.md");
  const section = doc.slice(doc.indexOf("## 5."), doc.indexOf("## 6."));
  return section
    .split("\n")
    .map((l) => l.match(/^\d+\. (.+?)(?:\s+\(closing track\))?$/)?.[1])
    .filter((l): l is string => Boolean(l));
}
