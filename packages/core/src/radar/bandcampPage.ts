import { isShowDate } from "../episode/dates";
import { metaTags } from "./bandcamp";
import { htmlToText, stripLinks } from "./email";

// Plan 8 Task 6b: what the ingest worker keeps from the one Bandcamp page it already reads for the player id (no new
// fetch): cover art, tags, the album description and the release date. Everything else on the page is discarded. The
// about is untrusted page text, display-only: it never reaches the agent. Tags are checked short words and may.

export const MAX_TAGS = 12;
export const MAX_TAG_CHARS = 40;
export const MAX_ABOUT_CHARS = 2_000;
const MAX_ART_CHARS = 500;
const MAX_ABOUT_HTML = 20_000; // the about block is cut to this before it is read
const MAX_TAG_LINKS = 200; // tag-class links looked at, at most (the scan itself is linear)

export type BandcampDetails = { art?: string; tags?: string[]; about?: string; releasedOn?: string; pageArtist?: string };

const ART_HOST = /^(?:[a-z0-9-]{1,63}\.){1,4}bcbits\.com$/;
const ART_PATH = /^\/img\/[A-Za-z0-9_-]{1,100}\.(?:jpe?g|png|gif|webp)$/i;
const TAG_CHARS = /^[\p{L}\p{N} &'\-/.]+$/u;
// Bounded repeats: each "<a" scans at most ~1,200 characters, so a page of them stays linear.
const TAG_LINK = /<a\b([^<>]{0,1000})>([^<>]{0,200})<\/a\s{0,20}>/gi;
const TAG_CLASS = /\bclass\s{0,20}=\s{0,20}["']tag["']/i;
// The release date, in the page's two shapes: the JSON-LD "29 Oct 2026 00:00:00 GMT" first, else the visible
// "released October 29, 2026". Bounded and anchored on a literal, so a page of near-misses stays linear.
const DATE_PUBLISHED = /"datePublished"\s{0,5}:\s{0,5}"(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/;
const RELEASED_TEXT = /released ([A-Z][a-z]{2,8}) (\d{1,2}), (\d{4})/;
// The page's artist: JSON-LD "byArtist": { ..., "name": "..." }. Bounded; a name holding an escape is skipped, not decoded.
const BY_ARTIST = /"byArtist"\s{0,5}:\s{0,5}\{([^{}]{0,1000})\}/;
const ARTIST_NAME = /"name"\s{0,5}:\s{0,5}"([^"\\]{0,300})"/;
const LINKISH = /:\/\/|@|\bwww\.|[a-z0-9-]\.[a-z]{2,}\//i;
const MAX_ARTIST_CHARS = 200; // radar's field limit
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ABOUT_OPEN = /class\s{0,20}=\s{0,20}"[^"<>]{0,200}\btralbum-about\b[^"<>]{0,200}"[^<>]{0,500}>/i;

/** Cover art: an https image on a *.bcbits.com host (no query, port or credentials), else null. The URL only, never the image. */
export function bandcampArtUrl(raw: string): string | null {
  if (raw.length > MAX_ART_CHARS || raw.includes("?") || raw.includes("#")) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !ART_HOST.test(u.hostname) || !ART_PATH.test(u.pathname)) return null;
  const art = `https://${u.hostname}${u.pathname}`;
  return art === raw ? art : null;
}

/**
 * One Bandcamp tag, lower-cased with its spaces collapsed, or null. Letters, numbers, space and & ' - / . only, at most
 * 40 characters, and a dot only before a space or the end, so nothing host-shaped ("bit.ly", "evil.example/a") is kept:
 * tags may reach the agent.
 */
export function bandcampTag(raw: string): string | null {
  if (raw.length > 400) return null;
  const tag = raw.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!tag || tag.length > MAX_TAG_CHARS || !TAG_CHARS.test(tag) || /\.\S/.test(tag) || /\bwww\./.test(tag)) return null;
  return tag;
}

/** Plain text, links and addresses stripped, at most 2,000 characters, or undefined when nothing is left. */
function plainAbout(html: string): string | undefined {
  const text = stripLinks(htmlToText(html.slice(0, MAX_ABOUT_HTML)).text).text.trim();
  return text ? text.slice(0, MAX_ABOUT_CHARS).trimEnd() : undefined;
}

/** "yyyy-mm-dd" from a day, a month name (full or its first three letters) and a year, or undefined. No Date parsing. */
function isoDate(day: string, month: string, year: string): string | undefined {
  const m = MONTHS.findIndex((name) => name === month || name.slice(0, 3) === month) + 1;
  const y = Number(year);
  if (!m || y < 1950 || y > 2100) return undefined;
  const iso = `${year}-${String(m).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isShowDate(iso) ? iso : undefined; // a real calendar day (Feb 29 only in a leap year)
}

/** The release date as yyyy-mm-dd: the JSON-LD datePublished, else the visible "released ..." line, else undefined. */
function releaseDate(html: string): string | undefined {
  const ld = DATE_PUBLISHED.exec(html);
  const fromLd = ld ? isoDate(ld[1]!, ld[2]!, ld[3]!) : undefined;
  if (fromLd) return fromLd;
  const text = RELEASED_TEXT.exec(html);
  return text ? isoDate(text[2]!, text[1]!, text[3]!) : undefined;
}

/** The artist the page names in its JSON-LD, or undefined (missing, empty, over 200 characters or link-shaped). */
function pageArtistOf(html: string): string | undefined {
  const name = ARTIST_NAME.exec(BY_ARTIST.exec(html)?.[1] ?? "")?.[1]?.trim();
  return name && name.length <= MAX_ARTIST_CHARS && !LINKISH.test(name) ? name : undefined;
}

/** The about block's inner HTML (up to the next `</div>`), or null. */
function aboutBlock(html: string): string | null {
  const open = ABOUT_OPEN.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const end = html.indexOf("</div", start);
  return html.slice(start, end < 0 ? start + MAX_ABOUT_HTML : Math.min(end, start + MAX_ABOUT_HTML));
}

/** Cover art, tags, the album description, the release date and the artist's name from a Bandcamp album or track page. Missing ones are left out. */
export function readBandcampDetails(html: string): BandcampDetails {
  const meta = metaTags(html);
  const content = (key: string) => meta.find((m) => m.key === key)?.content;

  const art = bandcampArtUrl(content("og:image") ?? "") ?? undefined;

  const tags: string[] = [];
  let seen = 0;
  for (const m of html.matchAll(TAG_LINK)) {
    if (tags.length >= MAX_TAGS) break;
    if (!TAG_CLASS.test(m[1]!)) continue; // ordinary links never count toward the cap
    if (++seen > MAX_TAG_LINKS) break;
    const tag = bandcampTag(htmlToText(m[2]!).text);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }

  const block = aboutBlock(html);
  const about = block !== null ? plainAbout(block) : plainAbout(content("og:description") ?? "");

  const releasedOn = releaseDate(html);
  const pageArtist = pageArtistOf(html);

  return { ...(art && { art }), ...(tags.length && { tags }), ...(about && { about }), ...(releasedOn && { releasedOn }), ...(pageArtist && { pageArtist }) };
}
