import { normalize } from "../tracklist/normalize";

export interface ActiveEmbargo {
  artist: string;
  title: string;
  until: string | null;
}

const MIN_TITLE_IN_PROSE = 4;
/** A bracket or dash suffix holding one of these is a credit or a version of the same recording. */
const SUFFIX_WORD = /\b(?:feat|ft|featuring|edit|mix|remix|remaster|remastered|version)\b/;
const DASHES = [" - ", " – ", " — "];
/** Credited artists: " & ", ", ", " x ", " and ", " with ", feat./ft./featuring. Run only on text with single spaces. */
const CREDIT = / (?:&|x|and|with|feat\.?|ft\.?|featuring) |, ?/;
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/** Lowercase, no accents, single spaces. Every pattern is one class or a literal, so it stays linear on hostile text. */
const lower = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A title as embargo matching compares it: folded, with up to three credit or version suffixes dropped, such as
 * "(feat. X)", "[Radio Edit]", "(X Remix)", "- Extended Version" or "(Remastered 2020)". Other parentheses stay.
 */
export function embargoTitle(s: string): string {
  let t = lower(s);
  for (let i = 0; i < 3; i++) {
    const before = t;
    const close = t.at(-1);
    if (close === ")" || close === "]") {
      const open = t.lastIndexOf(close === ")" ? "(" : "[");
      if (open > 0 && SUFFIX_WORD.test(t.slice(open))) t = t.slice(0, open).trimEnd();
    }
    const dash = Math.max(...DASHES.map((d) => t.lastIndexOf(d)));
    if (dash > 0 && SUFFIX_WORD.test(t.slice(dash))) t = t.slice(0, dash).trimEnd();
    if (t === before) break;
  }
  return normalize(t);
}

/**
 * Every artist an artist field credits, folded: the whole field and each part split on &, ",", x, and, with, feat.
 * Shared with Plan 7's past-show counts; callers compare parts by whole equality, so "Ama" never matches "Ama Ferrell".
 */
export function credits(s: string): Set<string> {
  const l = lower(s);
  return new Set([normalize(l), ...l.split(CREDIT).map(normalize)].filter(Boolean));
}

type Word = { word: string; start: number; end: number };
/** The words of `text` with their positions, folded one by one, so a match maps back to the text as written. */
const words = (text: string): Word[] =>
  [...text.matchAll(WORD)].map((m) => ({ word: lower(m[0]), start: m.index!, end: m.index! + m[0].length }));

/** The span of `text` where `phrase` (folded words, single spaces) first appears as whole words, or null. */
function findPhrase(text: string, ws: Word[], phrase: string): string | null {
  const p = phrase.split(" ");
  // ponytail: one pass over the words, at most p.length compares at each; p is a release title or artist (≤200 chars).
  for (let i = 0; i + p.length <= ws.length; i++) {
    if (p.every((w, j) => ws[i + j]!.word === w)) return text.slice(ws[i]!.start, ws[i + p.length - 1]!.end);
  }
  return null;
}

type Input = { description?: string; tracks?: { artist: string; title: string }[] };
export type EmbargoMatch = { where: "track" | "description"; text: string };

/**
 * Each active embargo the input breaks, with the input's own words that matched, and those it only touches by artist.
 * Blocking: a track crediting the release's artist (lead or any credited artist) with the same title once credit and
 * version suffixes are folded away, or the title (4+ characters, whole words) in the description. Generic, so a caller
 * can carry its own id on each embargo.
 */
export function embargoMatches<E extends ActiveEmbargo>(input: Input, active: E[]): { blocking: { embargo: E; matches: EmbargoMatch[] }[]; sameArtist: E[] } {
  const description = input.description ?? "";
  const ws = description ? words(description) : [];
  const tracks = (input.tracks ?? []).map((t) => ({ raw: t.title, credits: credits(t.artist), title: embargoTitle(t.title) }));
  const blocking: { embargo: E; matches: EmbargoMatch[] }[] = [];
  const sameArtist: E[] = [];
  for (const e of active) {
    const artists = credits(e.artist);
    const title = embargoTitle(e.title);
    const credited = (c: Set<string>) => [...c].some((a) => artists.has(a));
    const matches: EmbargoMatch[] = tracks
      .filter((t) => title && t.title === title && credited(t.credits))
      .map((t) => ({ where: "track", text: t.raw }));
    const inProse = title.length >= MIN_TITLE_IN_PROSE ? findPhrase(description, ws, title) : null;
    if (inProse) matches.push({ where: "description", text: inProse });
    if (matches.length) blocking.push({ embargo: e, matches });
    else if (tracks.some((t) => credited(t.credits)) || [...artists].some((a) => a.length >= MIN_TITLE_IN_PROSE && findPhrase(description, ws, a)))
      sameArtist.push(e);
  }
  return { blocking, sameArtist };
}

export function describeEmbargo(e: ActiveEmbargo): string {
  return `'${e.title}' by ${e.artist} is embargoed ${e.until ? `until ${e.until}` : "(date not known)"}`;
}

/** Which active embargoes some public text or tracklist would break, for a person: each release named in full. */
export function embargoHits(input: Input, active: ActiveEmbargo[]): { blocking: string[]; sameArtist: string[] } {
  const { blocking, sameArtist } = embargoMatches(input, active);
  return { blocking: [...new Set(blocking.map((b) => describeEmbargo(b.embargo)))], sameArtist: [...new Set(sameArtist.map(describeEmbargo))] };
}

/**
 * The same blocking matches for the agent (Hard Rule 10): only words its own description or tracklist holds, never
 * the release's artist or title, and nothing at all for a same-artist match.
 */
export function agentEmbargoLines(input: Input, active: ActiveEmbargo[]): string[] {
  const when = (e: ActiveEmbargo) => (e.until ? `until ${e.until}` : "(no date known)");
  const lines = embargoMatches(input, active).blocking.flatMap(({ embargo, matches }) =>
    matches.map((m) => `${m.where === "track" ? `The track "${m.text}" in your tracklist` : `The title "${m.text}" in your description`} is embargoed ${when(embargo)}.`),
  );
  return [...new Set(lines)];
}

/** `today` is a Chicago day key. An undated embargo (until: null) stays active until a person dates or clears it. */
export function isEmbargoActive(embargo: { until: string | null } | undefined, today: string): boolean {
  if (!embargo) return false;
  return embargo.until === null || today < embargo.until;
}
