import { type ActiveEmbargo, embargoMatches, embargoTitle } from "../radar/embargo";
import { normalize } from "../tracklist/normalize";
import type { Track } from "../types";
import { foldText } from "../radar/extract";
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

/** A numbered line: `N.` or `N)`, with or without `#`s or `**` before it. */
const NUMBERED = /^[#*\s]*(\d{1,3})[.)]\s/;
/** A numbered line that reads as a track heading: a `#`/`**` start, a double quote, a spaced dash, or a quote after a separator. */
const HEADING_LIKE = /^\s*(?:#|\*\*)|["“”]|\s[-–—]\s|[-–—:]\s*['‘’]/;
/** A level-1 or level-2 heading ends the track above it; `###` sits inside a track. */
const SECTION = /^#{1,2}\s/;

/**
 * One id per non-empty line (`L1`…), in order, the text verbatim. Fails closed (Hard Rule 4):
 * - a numbered heading names a track when its folded text holds the track's artist and title as whole words (any
 *   quotes, dash or colon); a numbered heading that names no track ends the one above it;
 * - any numbered line naming a closing track starts that track's block, heading or not;
 * - a level-1 or level-2 heading ends the block. Lines in a closing track's block are `closing`.
 */
export function numberLines(notes: string, tracks: ResearchTrack[]): NoteLine[] {
  const named = tracks
    .map((t) => ({ t, artist: ` ${normalize(t.artist)} `, title: ` ${normalize(t.title)} ` }))
    .filter((x) => x.artist.trim() && x.title.trim());
  const namedIn = (n: number, line: string) => {
    const hits = named.filter((x) => line.includes(x.artist) && line.includes(x.title)).map((x) => x.t);
    return hits.find((t) => t.position === n) ?? hits[0];
  };
  let current: ResearchTrack | undefined;
  const lines: NoteLine[] = [];
  for (const text of notes.split(/\r\n|\r|\n/)) {
    if (!text.trim()) continue;
    const num = text.match(NUMBERED);
    if (num) {
      const hit = namedIn(Number(num[1]), ` ${foldText(text)} `);
      if (HEADING_LIKE.test(text)) current = hit;
      else if (hit?.closing) current = hit;
    } else if (SECTION.test(text)) current = undefined;
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
  if (!active.length) return false;
  if (embargoMatches({ description: query }, active).blocking.length) return true;
  // foldText, not normalize: normalize drops a feat. clause and everything after it, which would hide the title.
  const q = ` ${foldText(query)} `;
  return active.some((e) => {
    const title = embargoTitle(e.title);
    return title !== "" && q.includes(` ${title} `) && q.includes(padded(e.artist));
  });
}
