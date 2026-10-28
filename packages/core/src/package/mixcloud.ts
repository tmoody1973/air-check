import type { Track } from "../types";
import { checkTags } from "./title";

export interface Section {
  artist: string;
  song: string;
}

export interface DescriptionSource {
  claim: string;
  source: string;
}

export interface PackageDraft {
  id: string;
  workspace: "real" | "demo";
  showDate: string;
  title: string;
  tags: string[];
  description: string;
  tracks: Track[];
  audio: { hour1Id: string; hour2Id: string; mp3Sha256?: string; hour1DurationSec?: number; mp3Bytes?: number };
  picture?: string;
  /** Convex file-storage id of the cover a human picked (packages.setCover). The agent never sets it. */
  coverStorageId?: string;
  /** Where each fact in the description came from. Shown to the reviewer; never sent to Mixcloud. */
  descriptionSources?: DescriptionSource[];
  /** Notes for the reviewer. Display only: never in the fingerprint or the upload. */
  flags?: string[];
  /** Other title options. Display only: never in the fingerprint or the upload. */
  alternates?: string[];
}

/** Artist and song only. Hard Rule 11: no start times, ever. */
export function toSections(tracks: Track[]): Section[] {
  return tracks.map((t) => ({ artist: t.artist, song: t.feat ? `${t.title} feat. ${t.feat}` : t.title }));
}

/** Text fields of a Mixcloud upload. The publisher adds the mp3 and picture files. */
export function toMixcloudFields(p: PackageDraft): Record<string, string> {
  const problems = checkTags(p.tags);
  if (problems.length) throw new Error(`invalid tags: ${problems.join(", ")}`);
  const fields: Record<string, string> = { name: p.title, description: p.description };
  p.tags.forEach((tag, i) => {
    fields[`tags-${i}-tag`] = tag;
  });
  toSections(p.tracks).forEach((s, i) => {
    fields[`sections-${i}-artist`] = s.artist;
    fields[`sections-${i}-song`] = s.song;
  });
  return fields;
}
