import { normalize } from "../tracklist/normalize";
import { foldText } from "./extract";

export interface ActiveEmbargo {
  artist: string;
  title: string;
  until: string | null;
}

const MIN_TITLE_IN_PROSE = 4;

/** `today` is a Chicago day key. An undated embargo (until: null) stays active until a person dates or clears it. */
export function isEmbargoActive(embargo: { until: string | null } | undefined, today: string): boolean {
  if (!embargo) return false;
  return embargo.until === null || today < embargo.until;
}

export function describeEmbargo(e: ActiveEmbargo): string {
  return `'${e.title}' by ${e.artist} is embargoed ${e.until ? `until ${e.until}` : "(date not known)"}`;
}

/**
 * Which active embargoes some public text or tracklist would break. Blocking: the exact normalized artist and title in
 * the tracks, or the title (4+ characters, word-bounded, case- and accent-insensitive) in the description.
 * sameArtist: the artist appears but not the release, a warning only.
 */
export function embargoHits(
  input: { description?: string; tracks?: { artist: string; title: string }[] },
  active: ActiveEmbargo[],
): { blocking: string[]; sameArtist: string[] } {
  const prose = input.description ? ` ${foldText(input.description)} ` : "";
  const inProse = (n: string) => n.length >= MIN_TITLE_IN_PROSE && prose.includes(` ${n} `);
  const tracks = (input.tracks ?? []).map((t) => ({ artist: normalize(t.artist), title: normalize(t.title) }));
  const blocking = new Set<string>();
  const sameArtist = new Set<string>();
  for (const e of active) {
    const artist = normalize(e.artist);
    const title = normalize(e.title);
    if (tracks.some((t) => t.artist === artist && t.title === title) || inProse(title)) blocking.add(describeEmbargo(e));
    else if ((artist && tracks.some((t) => t.artist === artist)) || inProse(artist)) sameArtist.add(describeEmbargo(e));
  }
  return { blocking: [...blocking], sameArtist: [...sameArtist] };
}
