import type { PackageDraft } from "../package/mixcloud";
import { toSections } from "../package/mixcloud";

const MAX_NAME = 100;
const MAX_DESCRIPTION = 1000;
const MAX_TAGS = 5;
const MAX_MP3_BYTES = 4 * 1024 ** 3;
const MAX_PICTURE_BYTES = 10 * 1024 ** 2;

const len = (s: string): number => [...s].length;

/** Things Mixcloud only tells you after the full upload. Empty array means OK to upload. */
export function validateForUpload(draft: PackageDraft, opts: { mp3Bytes: number; pictureBytes?: number }): string[] {
  const problems: string[] = [];
  const name = draft.title.trim();
  if (!name) problems.push("The title is empty");
  else if (len(name) > MAX_NAME) problems.push(`The title is ${len(name)} characters; Mixcloud allows ${MAX_NAME}`);
  if (len(draft.description) > MAX_DESCRIPTION) {
    problems.push(`The description is ${len(draft.description)} characters; Mixcloud allows ${MAX_DESCRIPTION}`);
  }
  const tagCount = draft.tags.filter((t) => t.trim()).length;
  if (tagCount > MAX_TAGS) problems.push(`There are ${tagCount} tags; Mixcloud allows ${MAX_TAGS}`);
  toSections(draft.tracks).forEach((s, i) => {
    if (!s.artist.trim() || !s.song.trim()) problems.push(`Track ${i + 1} is missing an artist or song name`);
  });
  if (opts.mp3Bytes > MAX_MP3_BYTES) problems.push("The mp3 is over Mixcloud's 4 GB limit");
  if (opts.pictureBytes !== undefined && opts.pictureBytes > MAX_PICTURE_BYTES) problems.push("The picture is over Mixcloud's 10 MB limit");
  return problems;
}
