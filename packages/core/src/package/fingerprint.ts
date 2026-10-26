import { createHash } from "node:crypto";
import { type PackageDraft, toSections } from "./mixcloud";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

/** Hash of exactly what will be published, including the MP3 file's own hash. */
export function fingerprint(p: PackageDraft): string {
  if (!p.audio.mp3Sha256) throw new Error("cannot fingerprint a package before its MP3 exists");
  const content = {
    workspace: p.workspace,
    title: p.title,
    tags: p.tags,
    description: p.description,
    sections: toSections(p.tracks),
    hour1Id: p.audio.hour1Id,
    hour2Id: p.audio.hour2Id,
    mp3Sha256: p.audio.mp3Sha256,
    picture: p.picture,
  };
  return createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}
