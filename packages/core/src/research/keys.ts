import { type ActiveEmbargo, embargoMatches, embargoTitle } from "../radar/embargo";
import { normalize } from "../tracklist/normalize";
import type { Track } from "../types";
import type { EmbargoMark, NoteLine, ResearchTrack } from "./types";

export const trackKey = (hour: number, position: number) => `H${hour}.${position}`;

export function researchTracks(tracks: Track[]): ResearchTrack[] {
  return tracks.map((t) => ({
    key: trackKey(t.hour, t.position),
    hour: t.hour,
    position: t.position,
    artist: t.artist,
    title: t.title,
    ...(t.feat ? { feat: t.feat } : {}),
    closing: t.closing,
  }));
}

/** `N. Artist – "Title"`, optionally after `#`s or inside `**`, any dash, straight or curly quotes. */
const TRACK_HEADING = /^[#*\s]*\d+\.\s+(.+?)\s+[-–—]\s*["“”](.+?)["“”]/;
/** Pasted notes are untrusted: a longer line is never a heading, so the lazy match stays cheap on hostile text. */
const HEADING_MAX = 300;
/** A level-1 or level-2 heading ends the track above it; `###` sits inside a track. */
const SECTION = /^#{1,2}\s/;

/**
 * One id per non-empty line (`L1`…), in order, the text verbatim. A track heading, and every line under it until
 * the next level-1 or level-2 heading, gets that track's key; under a closing track's heading they are `closing`.
 */
export function numberLines(notes: string, tracks: ResearchTrack[]): NoteLine[] {
  const byName = new Map(tracks.map((t) => [`${normalize(t.artist)}|${normalize(t.title)}`, t]));
  let current: ResearchTrack | undefined;
  const lines: NoteLine[] = [];
  for (const text of notes.split(/\r\n|\r|\n/)) {
    if (!text.trim()) continue;
    const heading = text.length <= HEADING_MAX ? text.match(TRACK_HEADING) : null;
    if (heading) current = byName.get(`${normalize(heading[1]!.replace(/\*/g, ""))}|${normalize(heading[2]!)}`);
    else if (SECTION.test(text)) current = undefined;
    lines.push({ id: `L${lines.length + 1}`, text, ...(current ? { trackKey: current.key } : {}), closing: current?.closing ?? false });
  }
  return lines;
}

/** A track's embargo: the one set on it, else Plan 8's matcher against today's active embargoes. */
export function trackEmbargo(t: { artist: string; title: string; embargo?: EmbargoMark }, active: ActiveEmbargo[] = []): EmbargoMark | undefined {
  if (t.embargo) return t.embargo;
  const hit = embargoMatches({ tracks: [t] }, active).blocking[0];
  return hit ? { until: hit.embargo.until } : undefined;
}

/** R2: the refusal names nothing, so it reveals no embargo (R8). */
export const EMBARGOED_SEARCH_REFUSAL = "Not searched. That track stays off web search for now; research it with Crate only.";

const padded = (s: string) => ` ${normalize(s)} `;
/**
 * R2: a source_search query that names an active embargo's release: its title in prose (Plan 8's matcher, 4+
 * characters), or the artist and a title of any length together.
 */
export function embargoedSearch(query: string, active: ActiveEmbargo[]): boolean {
  if (embargoMatches({ description: query }, active).blocking.length) return true;
  const q = padded(query);
  return active.some((e) => {
    const title = embargoTitle(e.title);
    return title !== "" && q.includes(` ${title} `) && q.includes(padded(e.artist));
  });
}
