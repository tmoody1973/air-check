import { normalize } from "../tracklist/normalize";
import type { Track } from "../types";

const MAX_TITLE = 100;
const MAX_TAGS = 5;

/** "2026-10-02" -> "10.2.26" */
export function formatShowDate(iso: string): string {
  const m = iso.match(/^\d{2}(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) throw new RangeError(`not an ISO date: ${iso}`);
  return `${Number(m[2])}.${Number(m[3])}.${m[1]}`;
}

/** `RLR M.D.YY | A, B, C, D and more` with 4 to 6 lead artists, under 100 characters. */
export function buildTitle(iso: string, leads: string[], sep: "|" | ":" = "|"): string {
  if (leads.length < 4 || leads.length > 6) throw new RangeError(`need 4 to 6 lead artists, got ${leads.length}`);
  const date = formatShowDate(iso);
  const title = `RLR ${date}${sep === "|" ? " |" : ":"} ${leads.join(", ")} and more`;
  if ([...title].length >= MAX_TITLE) throw new RangeError(`title is ${[...title].length} characters, must be under ${MAX_TITLE}`);
  return title;
}

/** Lead artists that do not appear in any track's artist credit. */
export function checkTitleArtists(leads: string[], tracks: Track[]): string[] {
  const artists = tracks.map((t) => normalize(t.artist));
  return leads.filter((lead) => !artists.some((a) => a.includes(normalize(lead))));
}

export function checkTags(tags: string[]): string[] {
  const problems: string[] = [];
  if (tags.length > MAX_TAGS) problems.push(`more than ${MAX_TAGS} tags`);
  if (tags.some((t) => !t.trim())) problems.push("empty tag");
  const seen = new Set<string>();
  for (const t of tags) {
    const key = t.trim().toLowerCase();
    if (key && seen.has(key)) problems.push(`duplicate tag: ${key}`);
    seen.add(key);
  }
  return problems;
}
