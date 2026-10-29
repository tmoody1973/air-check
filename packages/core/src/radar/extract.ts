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

// Bandcamp's real new-release line (live mail, 2026-10-29): `<sender> just released "<title>"( by <artist>), check it out at:`
// with the link on the next line. The brief states it as
//   ^(?<sender>.{1,200}?) just released "(?<title>.{1,300}?)"(?: by (?<artist>.{1,200}?))?, check it out at:\s*$
// That regex is bounded but cubic (sender x title x artist backtracking), so it is read here with literal scans instead,
// same meaning: straight or curly quotes, the title is the shortest quoted run that the rest fits, and the
// ", check it out at:" tail may be missing only when the line ends right after the closing quote.
const MAX_TEMPLATE_LINE = 500;
const RELEASED = " just released ";
const TAIL = ", check it out at:";
const OPEN_QUOTE = new Set(['"', "\u201c"]);
const CLOSE_QUOTE = new Set(['"', "\u201d"]);

function templateLine(line: string): { sender: string; title: string; artist?: string } | null {
  const at = line.indexOf(RELEASED);
  if (at < 1 || at > 200) return null;
  const tailed = line.endsWith(TAIL);
  const rest = line.slice(at + RELEASED.length, tailed ? -TAIL.length : undefined);
  if (!OPEN_QUOTE.has(rest[0] ?? "")) return null;
  for (let q = 2; q < rest.length && q <= 301; q++) {
    if (!CLOSE_QUOTE.has(rest[q]!)) continue;
    const title = rest.slice(1, q);
    if (q === rest.length - 1) return { sender: line.slice(0, at), title };
    const artistLength = rest.length - (q + 5);
    if (tailed && rest.startsWith(" by ", q + 1) && artistLength >= 1 && artistLength <= 200) return { sender: line.slice(0, at), title, artist: rest.slice(q + 5) };
  }
  return null;
}

/**
 * Bandcamp's new-release template, read in code. With "by", the by-part is the artist and the sender is the label;
 * without it, the sender is the artist and there is no label. The title is the quoted text as is (it may hold an
 * unbalanced bracket). Null when no line matches: the email then goes to the model, as any other.
 */
export function parseBandcampEmail(_subject: string, text: string): ReleaseFields | null {
  const lines = text.split("\n");
  for (const [i, raw] of lines.entries()) {
    if (raw.length > MAX_TEMPLATE_LINE) continue;
    const g = templateLine(raw.trim());
    const [sender, title, by] = [g?.sender.trim(), g?.title.trim(), g?.artist?.trim()];
    if (!sender || !title) continue;
    const releasedOn = lines.filter((l, j) => j !== i && /releas/i.test(l)).flatMap((l) => datesIn(l))[0];
    return { artist: by || sender, title, ...(by ? { label: sender } : {}), ...(releasedOn ? { releasedOn } : {}) };
  }
  return null;
}

export type Extraction = { ok: true; release: ReleaseFields; notes: string[] } | { ok: false; notRelease: true } | { ok: false; reasons: string[] };

const LINKISH = /https?:|hxxp|:\/\/|www\.|@|\(at\)|\[\.\]|\[link\]|\[email\]|[a-z0-9-]\.[a-z]{2,}\//i;
const TYPES = new Set(["album", "single", "ep"]);
const field = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

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
    },
    notes,
  };
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
