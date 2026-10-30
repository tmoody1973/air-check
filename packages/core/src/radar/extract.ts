import { isShowDate } from "../episode/dates";
import { chicagoDayKey } from "../publish/pacing";
import { normalize } from "../tracklist/normalize";

export interface ReleaseFields {
  artist: string;
  title: string;
  label?: string;
  type?: "album" | "single" | "ep";
  releasedOn?: string;
  genre?: string;
  embargo?: { until: string | null };
  /** Decision 027: the number N of this release's [image N] marker in the stored email. A number, never an address. */
  image?: number;
  /** Decision 027: the numbers of this release's [link N] markers in the stored email. Numbers, never addresses. */
  links?: number[];
}

/** Text sent to the model is cut to this. */
export const MAX_EMAIL_CHARS = 12_000;
const MAX_FIELD_CHARS = 200;

/** Lowercase, accents and punctuation folded to spaces. Unlike normalize, keeps a "feat." clause, so it is safe on prose. */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b\\.?";
const ORD = "(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4})\\b)?";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const pad = (n: number) => String(n).padStart(2, "0");

/** [match position, month, day, year?] for each date-shaped run. */
function dateParts(text: string): [number, number, number, number | undefined][] {
  const out: [number, number, number, number | undefined][] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) out.push([m.index!, +m[2]!, +m[3]!, +m[1]!]);
  for (const m of text.matchAll(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})${ORD}\\b${YEAR}`, "gi")))
    out.push([m.index!, monthOf(m[1]!), +m[2]!, m[3] ? +m[3] : undefined]);
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})${ORD}\\s+${MONTH}${YEAR}`, "gi")))
    out.push([m.index!, monthOf(m[2]!), +m[1]!, m[3] ? +m[3] : undefined]);
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/g)) out.push([m.index!, +m[1]!, +m[2]!, +m[3]!]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** ISO dates in order of appearance. Without receivedAt, a date with no year is skipped. */
function datesIn(text: string, receivedAt?: number): string[] {
  const today = receivedAt === undefined ? undefined : chicagoDayKey(receivedAt);
  const out = dateParts(text).flatMap(([, month, day, year]) => {
    if (year !== undefined) {
      const iso = `${year}-${pad(month)}-${pad(day)}`;
      return isShowDate(iso) ? [iso] : [];
    }
    if (!today) return [];
    const y = Number(today.slice(0, 4));
    // A date with no year is the next one on or after the day the email arrived.
    const iso = [y, y + 1].map((yy) => `${yy}-${pad(month)}-${pad(day)}`).find((d) => isShowDate(d) && d >= today);
    return iso ? [iso] : [];
  });
  return [...new Set(out)];
}

/** ISO dates from 2026-11-07, November 7(, 2026), 7 November 2026 and 11/7/2026. A year-less date takes the next one on or after receipt (America/Chicago). */
export function findDates(text: string, receivedAt: number): string[] {
  return datesIn(text, receivedAt);
}

const EMBARGO = /\bembargo|\bnot for (?:broadcast|airplay) before\b|\bdo not (?:play|post) before\b|\bhold until\b/i;
const NO_EMBARGO = /\b(?:no|not|without)\s+(?:an?\s+)?embargo\w*/gi;
const SENTENCES = /\n+|(?<=[.!?])\s+(?=[A-Z"'“(\[])/;

/**
 * Embargo wording and a date in the same sentence. Wording with no readable date is { until: null }, which stays active
 * until a person dates or clears it. Several dated sentences take the latest date (a late date holds a post back; an
 * early one would let it out).
 */
export function findEmbargo(text: string, receivedAt: number): { until: string | null } | null {
  let found = false;
  const dates: string[] = [];
  for (const sentence of text.split(SENTENCES)) {
    if (!EMBARGO.test(sentence.replace(NO_EMBARGO, " "))) continue;
    found = true;
    dates.push(...findDates(sentence, receivedAt));
  }
  if (!found) return null;
  return { until: dates.length ? dates.sort().at(-1)! : null };
}

// Bandcamp's new-release line (live mail, 2026-10-29): `<sender> just released|announced "<title>"( by <artist>), check it out at:`
// (or `, check it out here`), the link on the next line. A hand-forward may leave the quotes off and wrap the line.
// Read with literal scans, never a regex: every step is linear in the 500-char line.
const MAX_TEMPLATE_LINE = 500;
const VERBS = [" just released ", " just announced "];
const TAILS = [", check it out at:", ", check it out here"].flatMap((t) => [t, `${t}:`, `${t}.`]).filter((t, i, all) => all.indexOf(t) === i);
const OPEN_QUOTE = new Set(['"', "\u201c"]);
const CLOSE_QUOTE = new Set(['"', "\u201d"]);
const MAX_JOINED_LINES = 3;

function verbAt(line: string): { at: number; len: number } | null {
  const hits = VERBS.map((v) => ({ at: line.indexOf(v), len: v.length })).filter((h) => h.at >= 0);
  return hits.length ? hits.reduce((a, b) => (b.at < a.at ? b : a)) : null;
}

function templateLine(line: string): { sender: string; title: string; artist?: string } | null {
  const verb = verbAt(line);
  if (!verb || verb.at < 1 || verb.at > 200) return null;
  const tail = TAILS.find((t) => line.endsWith(t));
  const rest = line.slice(verb.at + verb.len, tail ? -tail.length : undefined);
  const sender = line.slice(0, verb.at);
  if (!OPEN_QUOTE.has(rest[0] ?? "")) {
    // ponytail: unquoted needs the tail; the last " by " splits title from artist, so a title holding " by " is mis-split.
    if (!tail) return null;
    const by = rest.lastIndexOf(" by ");
    if (by < 0) return rest.length >= 1 && rest.length <= 300 ? { sender, title: rest } : null;
    const [title, artist] = [rest.slice(0, by), rest.slice(by + 4)];
    return title.length >= 1 && title.length <= 300 && artist.length >= 1 && artist.length <= 200 ? { sender, title, artist } : null;
  }
  for (let q = 2; q < rest.length && q <= 301; q++) {
    if (!CLOSE_QUOTE.has(rest[q]!)) continue;
    const title = rest.slice(1, q);
    if (q === rest.length - 1) return { sender, title };
    const artistLength = rest.length - (q + 5);
    if (tail && rest.startsWith(" by ", q + 1) && artistLength >= 1 && artistLength <= 200) return { sender, title, artist: rest.slice(q + 5) };
  }
  return null;
}

/** The line at i, then (when it holds the verb) up to two more lines joined by a space, until one reads as the template. */
function templateAt(lines: string[], i: number): ReturnType<typeof templateLine> {
  let joined = "";
  for (let k = 0; k < MAX_JOINED_LINES && i + k < lines.length; k++) {
    joined = k === 0 ? lines[i]!.trim() : `${joined} ${lines[i + k]!.trim()}`;
    if (joined.length > MAX_TEMPLATE_LINE) return null;
    const g = templateLine(joined);
    if (g) return g;
  }
  return null;
}

/**
 * Bandcamp's new-release template, read in code. With "by", the by-part is the artist and the sender is the label;
 * without it, the sender is the artist and there is no label. The title is the text as is (it may hold an
 * unbalanced bracket). Null when no line matches: the email then goes to the model, as any other. The subject is
 * not read (a "Fwd:" prefix changes nothing here).
 */
export function parseBandcampEmail(_subject: string, text: string): ReleaseFields | null {
  const lines = text.split("\n");
  for (const [i, raw] of lines.entries()) {
    if (!VERBS.some((v) => raw.includes(v.trimEnd()))) continue;
    const g = templateAt(lines, i);
    const [sender, title, by] = [g?.sender.trim(), g?.title.trim(), g?.artist?.trim()];
    if (!sender || !title) continue;
    const releasedOn = lines.filter((l, j) => j !== i && /releas/i.test(l)).flatMap((l) => datesIn(l))[0];
    return { artist: by || sender, title, ...(by ? { label: sender } : {}), ...(releasedOn ? { releasedOn } : {}) };
  }
  return null;
}

export type Extraction = { ok: true; release: ReleaseFields; notes: string[] } | { ok: false; notRelease: true } | { ok: false; reasons: string[] };

const LINKISH = /https?:|hxxp|:\/\/|www\.|@|\(at\)|\[\.\]|\[(?:link|image|email)(?: \d{1,6})?\]|[a-z0-9-]\.[a-z]{2,}\//i;
const TYPES = new Set(["album", "single", "ep"]);
const field = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const MAX_RELEASE_LINKS = 20;
/** A marker number: an integer, or a string of digits only. An address or anything else is NaN. */
const markerNo = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN);

/** The [image N] and [link N] numbers the email text holds. */
function markerNumbers(text: string): { image: Set<number>; link: Set<number> } {
  const found = { image: new Set<number>(), link: new Set<number>() };
  for (const m of text.matchAll(/\[(image|link) (\d{1,3})\]/g)) found[m[1] as "image" | "link"].add(Number(m[2]));
  return found;
}

/** Decision 027: the reader's cover and link numbers for one release, kept only when each is a marker in the email. */
function mediaOf(c: Record<string, unknown>, emailText: string, notes: string[]): Pick<ReleaseFields, "image" | "links"> {
  const markers = markerNumbers(emailText);
  let image: number | undefined;
  if (c.image !== undefined && c.image !== null) {
    const n = markerNo(c.image);
    if (markers.image.has(n)) image = n;
    else notes.push("The cover was left out: it is not an image number in the email.");
  }
  let links: number[] = [];
  if (c.links !== undefined && c.links !== null) {
    const given = Array.isArray(c.links) ? c.links : [c.links];
    links = [...new Set(given.map(markerNo).filter((n) => markers.link.has(n)))].slice(0, MAX_RELEASE_LINKS);
    if (links.length < given.length) notes.push("Some links were left out: they are not link numbers in the email.");
  }
  return { ...(image !== undefined ? { image } : {}), ...(links.length ? { links } : {}) };
}

/**
 * The model's reading of a co-sign, checked in code. Artist and title must be in the email; a label or genre not in
 * the email (or shaped like a link) is dropped with a note; a release date must be one code found; any other key is
 * dropped. The embargo is set when code or the model finds one, and its date is kept only if code found it in the email.
 */
export function checkExtraction(candidate: unknown, emailText: string, receivedAt: number): Extraction {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return { ok: false, reasons: ["The reader's reply was not a JSON object"] };
  const c = candidate as Record<string, unknown>;
  if (c.notRelease === true) return { ok: false, notRelease: true };

  const haystack = ` ${foldText(emailText)} `;
  // The whole value is grounded: normalize would cut a "feat." tail and let anything after it through.
  const inEmail = (v: string) => {
    const n = foldText(v);
    return n.length > 0 && haystack.includes(` ${n} `);
  };
  const reasons: string[] = [];
  const notes: string[] = [];

  const required = (key: "artist" | "title") => {
    const v = field(c[key]);
    if (!v) reasons.push(`The ${key} is missing`);
    else if (LINKISH.test(v)) reasons.push(`The ${key} looks like a link or an address`);
    else if (v.length > MAX_FIELD_CHARS) reasons.push(`The ${key} is too long`);
    else if (!inEmail(v)) reasons.push(`The ${key} is not in the email`); // never the model's value: reasons are stored text
    else return v;
    return "";
  };
  // Dropped values are never echoed into a note: a note is stored text and must not carry a link.
  const grounded = (key: "label" | "genre") => {
    if (c[key] === undefined || c[key] === null) return undefined;
    const v = field(c[key]);
    if (v && !LINKISH.test(v) && v.length <= MAX_FIELD_CHARS && inEmail(v)) return v;
    notes.push(`The ${key} was left out: it is not in the email.`);
    return undefined;
  };

  const artist = required("artist");
  const title = required("title");
  const label = grounded("label");
  const genre = grounded("genre");

  let type: ReleaseFields["type"];
  if (c.type !== undefined && c.type !== null) {
    const t = field(c.type).toLowerCase();
    if (TYPES.has(t)) type = t as ReleaseFields["type"];
    else notes.push("The type was left out: it is not album, single or EP.");
  }

  const dates = findDates(emailText, receivedAt);
  let releasedOn: string | undefined;
  if (c.releasedOn !== undefined && c.releasedOn !== null) {
    const d = field(c.releasedOn);
    if (dates.includes(d)) releasedOn = d;
    else notes.push("The release date was left out: code did not find that date in the email.");
  }

  const embargo = embargoOf(c.embargo, findEmbargo(emailText, receivedAt), dates, notes);
  const media = mediaOf(c, emailText, notes);

  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    release: {
      artist,
      title,
      ...(label ? { label } : {}),
      ...(type ? { type } : {}),
      ...(releasedOn ? { releasedOn } : {}),
      ...(genre ? { genre } : {}),
      ...(embargo ? { embargo } : {}),
      ...media,
    },
    notes,
  };
}

/** A roundup names at most this many releases (decision 024). */
export const MAX_RELEASES = 12;

export type Extractions = { ok: true; releases: ReleaseFields[]; notes: string[] } | { ok: false; notRelease: true } | { ok: false; reasons: string[] };

/**
 * Decision 024: the reader's answer for one email, which may name several releases (`{ "releases": [...] }`) or one (the
 * old single object). Each release passes checkExtraction on its own; a roundup keeps the grounded ones (a dropped one is
 * counted in a note, never named), drops repeats by release key and stops at 12. None grounded: refused with the first
 * one's reasons. An empty list is not a release.
 */
export function checkExtractions(candidate: unknown, emailText: string, receivedAt: number): Extractions {
  const list = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>).releases : undefined;
  if (list === undefined) {
    const one = checkExtraction(candidate, emailText, receivedAt);
    return one.ok ? { ok: true, releases: [one.release], notes: one.notes } : one;
  }
  if (!Array.isArray(list)) return { ok: false, reasons: ["The reader's list of releases was not a list"] };
  if (list.length === 0) return { ok: false, notRelease: true };
  const checked = list.slice(0, MAX_RELEASES * 2).map((c) => checkExtraction(c, emailText, receivedAt));
  const keys = new Set<string>();
  const releases: ReleaseFields[] = [];
  const notes: string[] = [];
  for (const x of checked) {
    if (!x.ok || releases.length >= MAX_RELEASES) continue;
    const key = releaseKey(x.release.artist, x.release.title);
    if (keys.has(key)) continue;
    keys.add(key);
    releases.push(x.release);
    notes.push(...x.notes);
  }
  if (!releases.length) {
    const first = checked.find((x) => !x.ok && "reasons" in x);
    return first && !first.ok && "reasons" in first ? first : { ok: false, notRelease: true };
  }
  const dropped = checked.filter((x) => !x.ok).length;
  if (dropped) notes.push(`${dropped} release${dropped === 1 ? " was" : "s were"} left out: not found in the email.`);
  return { ok: true, releases, notes };
}

function embargoOf(model: unknown, code: { until: string | null } | null, dates: string[], notes: string[]): { until: string | null } | undefined {
  // Any signal at all counts (fail safe); only undefined, null and false mean "none".
  const modelFound = model !== undefined && model !== null && model !== false;
  if (!code && !modelFound) return undefined;
  const claimed = typeof model === "string" ? field(model) : typeof model === "object" && model ? field((model as Record<string, unknown>).until) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(claimed) && !dates.includes(claimed)) notes.push("The embargo date was left out: code did not find that date in the email. It stays embargoed until someone dates it.");
  const known = [code?.until, claimed && dates.includes(claimed) ? claimed : null].filter((d): d is string => Boolean(d));
  return { until: known.length ? known.sort().at(-1)! : null };
}

/** The key two emails about the same release share: core's normalize of each part, joined by |. */
export function releaseKey(artist: string, title: string): string {
  return `${normalize(artist)}|${normalize(title)}`;
}
