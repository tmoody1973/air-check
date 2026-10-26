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

/** The main title and two alternates from section 2 of the golden package fixture. */
export function goldenPackageTitles(): string[] {
  const doc = readFixture("RLR-10-2-26-mixcloud-package.md");
  return [...doc.slice(doc.indexOf("## 2."), doc.indexOf("## 3.")).matchAll(/^(?:\*\*|- )(RLR [^*\n]+)/gm)].map(
    (m) => m[1]!.trim(),
  );
}

/** Lead artists in a title like "RLR 10.2.26 | A, B, C and more". */
export function leadsOf(title: string): string[] {
  return title
    .replace(/^RLR \S+?(?: \||:) /, "")
    .replace(/ and more$/, "")
    .split(", ");
}

/** The public description from section 4 of the golden fixture, without the parenthetical notes. */
export function goldenDescription(): string {
  const doc = readFixture("RLR-10-2-26-mixcloud-package.md");
  return doc
    .slice(doc.indexOf("## 4.") + "## 4. Description".length, doc.indexOf("## 5."))
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("("))
    .join("\n\n");
}
