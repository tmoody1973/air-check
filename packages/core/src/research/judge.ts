import { foldText } from "../radar/extract";
import { type CitedSource, type ClaimInput, type ClaimKind, CRITICAL_KINDS, type JudgedClaim, type ResolvedSource, VALUE_KINDS } from "./types";

/** Never primary: they copy from elsewhere. Two different ones still count as two publishers (R5). */
export const AGGREGATORS: readonly string[] = [
  "musicbrainz.org", "discogs.com", "wikipedia.org", "genius.com", "last.fm", "allmusic.com", "rateyourmusic.com", "apple.com",
  "spotify.com", "youtube.com", "tidal.com", "deezer.com", "amazon.com", "whosampled.com", "daily.bandcamp.com",
  "youtu.be", "bandcamp.com", "soundcloud.com", "qobuz.com", "beatport.com",
];
const SECOND_LEVEL = ["co", "com", "org", "net"];

/** Who published a page: each `<name>.bandcamp.com` on its own; else the registrable domain (`bbc.co.uk`). */
export function publisherOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "").replace(/^m\./, "");
  if (h.endsWith(".bandcamp.com")) return h;
  const parts = h.split(".");
  const n = parts.length >= 3 && SECOND_LEVEL.includes(parts.at(-2)!) && parts.at(-1)!.length === 2 ? 3 : 2;
  return parts.slice(-n).join(".");
}

/**
 * R8b/R8c: Crate sources. A host inside the tool family's own domains is judged like any page (two *.bandcamp.com
 * pages are two publishers; an artist's own Bandcamp page may be primary). A host outside them is the family's text
 * about another page (an iTunes artwork link, a link inside a Wikipedia summary): it counts as the family's one
 * publisher and is never primary.
 */
const CRATE_FAMILY: Record<string, { publisher: string; owns: (host: string) => boolean }> = {
  musicbrainz: { publisher: "musicbrainz.org", owns: (h) => h === "musicbrainz.org" },
  wikipedia: { publisher: "wikipedia.org", owns: (h) => h === "wikipedia.org" || h.endsWith(".wikipedia.org") },
  bandcamp: { publisher: "bandcamp.com", owns: (h) => h === "bandcamp.com" || h.endsWith(".bandcamp.com") },
  itunes: { publisher: "apple.com", owns: (h) => h === "apple.com" || h.endsWith(".apple.com") },
};
function publisherOfSource(s: { host: string; via: string }): { publisher: string; offFamily: boolean } {
  if (!s.via.startsWith("crate:")) return { publisher: publisherOf(s.host), offFamily: false };
  const name = s.via.slice("crate:".length).split("_")[0]!;
  const family = CRATE_FAMILY[name];
  const host = s.host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (family?.owns(host)) return { publisher: publisherOf(s.host), offFamily: false };
  return { publisher: family?.publisher ?? `crate:${name}`, offFamily: true };
}

const fold = foldText;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
// Most specific first, so a year inside a full date is never read on its own. Numeric slash dates are ambiguous
// (10/11 is October or November): matched so their year is not read alone, then read as nothing.
const DATE = new RegExp(
  [
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
    // An ISO timestamp (2026-10-10T00:00Z) reads at day precision.
    String.raw`\b(\d{4})-(\d{2})(?:-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)?\b`,
    String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH},?\s+(\d{4})\b`,
    String.raw`\b${MONTH},?\s+(\d{4})\b`,
    String.raw`\b((?:19|20)\d{2})\b`,
  ].join("|"),
  "gi",
);

const pad = (n: number) => String(n).padStart(2, "0");
function isoDate(year: string, month?: number, day?: number): string | null {
  if (month === undefined) return year;
  if (month < 1 || month > 12) return null;
  if (day === undefined) return `${year}-${pad(month)}`;
  // A real calendar day only: 2026-02-31 is no date.
  return day >= 1 && new Date(Date.UTC(Number(year), month - 1, day)).getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : null;
}
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** A DATE match as ISO at the precision written, or null for a numeric slash date or an impossible one. */
function readDate(m: RegExpMatchArray): string | null {
  const g = m.slice(1);
  if (g[0]) return isoDate(g[0], Number(g[1]), g[2] ? Number(g[2]) : undefined);
  if (g[3]) return isoDate(g[5]!, monthOf(g[3]), Number(g[4]));
  if (g[6]) return isoDate(g[8]!, monthOf(g[7]!), Number(g[6]));
  if (g[9]) return isoDate(g[10]!, monthOf(g[9]));
  if (g[11]) return g[11];
  return null;
}

const datesIn = (text: string) => [...text.matchAll(DATE)].map(readDate).filter((d): d is string => d !== null);
const LABEL_SUFFIX = /(?: (?:records|recordings|music|ltd|inc))+$/;

/** A value as claims compare it, or null when it cannot be read (an ambiguous numeric date, a length with no m:ss). */
export function normalizeValue(kind: ClaimKind, value: string): string | null {
  const v = value.trim();
  switch (kind) {
    case "release-date": {
      const m = [...v.matchAll(DATE)];
      return m.length === 1 && m[0]![0] === v ? readDate(m[0]!) : null;
    }
    case "label":
      return fold(v).replace(LABEL_SUFFIX, "") || null;
    case "track-number": {
      const n = v.match(/\d+/);
      return n ? String(Number(n[0])) : null;
    }
    case "length": {
      const m = v.match(/(\d+):(\d{2})/);
      return m ? `${Number(m[1])}:${m[2]}` : null;
    }
    default:
      return fold(v) || null;
  }
}

/** Oct 29: a value on a long page counts only this close to a mention of the track's artist or title. */
export const NEAR_CHARS = 300;
/** Texts this long or shorter (the ledger's cap before page text) are read whole, as before. */
const WHOLE_TEXT = 2_000;

/** `fold(text)` built one character at a time, with the raw index of each folded character, so a match maps back. */
function foldIndexed(text: string): { folded: string; at: number[] } {
  const out: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    for (const c of ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")) {
      if (c === " " && (out.length === 0 || out[out.length - 1] === " ")) continue;
      out.push(c);
      for (let k = 0; k < c.length; k++) at.push(i); // one index per UTF-16 unit, so at[] lines up with the string
    }
    i += ch.length;
  }
  return { folded: out.join(""), at };
}

/**
 * The parts of a source's text a value may come from. A short text, or no names to look for, is the whole text. A long
 * one is the stretches within NEAR_CHARS of a folded mention of any name (artist or title), merged; none when no name
 * appears. Linear: one fold pass, then indexOf per name.
 */
function partsNear(text: string, near: readonly string[]): string[] {
  const names = [...new Set(near.map(fold).filter(Boolean))];
  if (text.length <= WHOLE_TEXT || !names.length) return [text];
  const { folded, at } = foldIndexed(text);
  const padded = ` ${folded} `;
  const spans: [number, number][] = [];
  for (const name of names) {
    // padded[p] is the space before the name, so the name starts at folded[p].
    for (let p = padded.indexOf(` ${name} `); p !== -1; p = padded.indexOf(` ${name} `, p + name.length + 1)) {
      spans.push([Math.max(0, at[p]! - NEAR_CHARS), Math.min(text.length, at[p + name.length - 1]! + 1 + NEAR_CHARS)]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged.map(([a, b]) => text.slice(a, b));
}

function saysWhole(text: string, kind: ClaimKind, want: string): boolean {
  // A year-only value is shown by any date in that year; judgeClaim still needs a month before it confirms.
  if (kind === "release-date") return datesIn(text).some((d) => d === want || (want.length === 4 && d.startsWith(`${want}-`)));
  return ` ${fold(text)} `.includes(` ${fold(want)} `);
}

/**
 * Whether a source's own text shows the value: any date in it equal at the same precision, else the folded words. With
 * `near` (the track's artist and title), a long text shows it only within NEAR_CHARS of one of them, so a discography
 * or catalog page cannot "show" another record's date or label.
 */
export function sourceSays(text: string, kind: ClaimKind, value: string, near: readonly string[] = []): boolean {
  const want = normalizeValue(kind, value);
  if (want === null) return false;
  return partsNear(text, near).some((part) => saysWhole(part, kind, want));
}

const unique = (xs: string[]) => [...new Set(xs)];

/**
 * The two-source rule, in code. `near` is the block's track (artist, title) or subject: on a long source the value must
 * sit near one of them (sourceSays). Value claims count a source only when its text shows the value; critical claims
 * need two publishers or a primary source that is not an aggregator; sources that disagree are a conflict.
 */
export function judgeClaim(claim: ClaimInput, sources: Record<string, ResolvedSource>, near: readonly string[] = []): JudgedClaim {
  const valueKind = VALUE_KINDS.includes(claim.kind);
  const textOf = new Map<CitedSource, string[]>();
  const cited: CitedSource[] = claim.sources.map((c) => {
    const s = sources[c.id];
    if (!s) throw new Error(`judgeClaim: ${c.id} was not resolved`); // the bridge refuses unknown ids first
    const says = c.says ?? claim.value;
    const out: CitedSource = {
      url: s.url,
      host: s.host,
      title: s.title,
      via: s.via,
      ...(c.says !== undefined ? { says: c.says } : {}),
      primary: c.primary === true,
      matched: !valueKind || (says !== undefined && sourceSays(s.text, claim.kind, says, near)),
    };
    textOf.set(out, partsNear(s.text, near));
    return out;
  });
  const base = { kind: claim.kind, text: claim.text, ...(claim.value !== undefined ? { value: claim.value } : {}), sources: cited };
  const usable = cited.filter((s) => s.matched);
  if (!usable.length) {
    const check = valueKind && claim.value !== undefined ? `No source shows ${claim.value}` : "No source";
    return { ...base, status: "could-not-verify", check };
  }
  if (!CRITICAL_KINDS.includes(claim.kind)) return { ...base, status: "sourced" };

  const groups = new Map<string, { shown: string; hosts: string[] }>();
  for (const s of usable) {
    const raw = s.says ?? claim.value ?? "";
    const key = normalizeValue(claim.kind, raw) ?? raw;
    const g = groups.get(key) ?? { shown: claim.kind === "release-date" ? key : raw, hosts: [] };
    groups.set(key, { ...g, hosts: unique([...g.hosts, s.host]) });
  }
  const own = claim.value === undefined ? undefined : normalizeValue(claim.kind, claim.value) ?? claim.value;
  const listed = [...groups.values()].map((g) => `${g.shown} (${g.hosts.join(", ")})`);
  if (groups.size > 1) return { ...base, status: "conflict", check: `Sources disagree: ${listed.join(" vs ")}` };
  if (own !== undefined && !groups.has(own)) return { ...base, status: "conflict", check: `Sources show ${listed[0]}, not ${claim.value}` };

  const publishers = unique(usable.map((s) => publisherOfSource(s).publisher));
  const primary = usable.some((s) => {
    const p = publisherOfSource(s);
    return s.primary && !p.offFamily && !AGGREGATORS.includes(p.publisher);
  });
  const yearOnly = claim.kind === "release-date" && own?.length === 4;
  const monthShown = usable.some((s) => textOf.get(s)!.some((part) => datesIn(part).some((d) => d.length >= 7 && d.startsWith(`${own}-`))));
  if (yearOnly && !monthShown) return { ...base, status: "could-not-verify", check: `Only the year ${own} is shown; check the full date` };
  if (publishers.length >= 2 || primary) return { ...base, status: "confirmed" };
  return { ...base, status: "could-not-verify", check: `Only one source: ${publishers[0]}` };
}
