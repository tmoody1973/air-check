import { type CitedSource, type ClaimInput, type ClaimKind, CRITICAL_KINDS, type JudgedClaim, type ResolvedSource, VALUE_KINDS } from "./types";

/** Never primary: they copy from elsewhere. Two different ones still count as two publishers (R5). */
export const AGGREGATORS: readonly string[] = [
  "musicbrainz.org", "discogs.com", "wikipedia.org", "genius.com", "last.fm", "allmusic.com", "rateyourmusic.com", "apple.com",
  "spotify.com", "youtube.com", "tidal.com", "deezer.com", "amazon.com", "whosampled.com", "daily.bandcamp.com",
];
const SECOND_LEVEL = ["co", "com", "org", "net"];

/** Who published a page: each `<name>.bandcamp.com` on its own; else the registrable domain (`bbc.co.uk`). */
export function publisherOf(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (h.endsWith(".bandcamp.com")) return h;
  const parts = h.split(".");
  const n = parts.length >= 3 && SECOND_LEVEL.includes(parts.at(-2)!) && parts.at(-1)!.length === 2 ? 3 : 2;
  return parts.slice(-n).join(".");
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
// Most specific first, so a year inside a full date is never read on its own. Numeric slash dates are ambiguous
// (10/11 is October or November): matched so their year is not read alone, then read as nothing.
const DATE = new RegExp(
  [
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
    String.raw`\b(\d{4})-(\d{2})(?:-(\d{2}))?\b`,
    String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
    String.raw`\b(\d{1,2})\s+${MONTH},?\s+(\d{4})\b`,
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
  return day >= 1 && day <= 31 ? `${year}-${pad(month)}-${pad(day)}` : null;
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

/** Whether a source's own text shows the value: any date in it equal at the same precision, else the folded words. */
export function sourceSays(text: string, kind: ClaimKind, value: string): boolean {
  const want = normalizeValue(kind, value);
  if (want === null) return false;
  if (kind === "release-date") return datesIn(text).includes(want);
  return ` ${fold(text)} `.includes(` ${fold(want)} `);
}

const unique = (xs: string[]) => [...new Set(xs)];

/**
 * The two-source rule, in code. Value claims count a source only when its text shows the value; critical claims
 * need two publishers or a primary source that is not an aggregator; sources that disagree are a conflict.
 */
export function judgeClaim(claim: ClaimInput, sources: Record<string, ResolvedSource>): JudgedClaim {
  const valueKind = VALUE_KINDS.includes(claim.kind);
  const cited: CitedSource[] = claim.sources.map((c) => {
    const s = sources[c.id];
    if (!s) throw new Error(`judgeClaim: ${c.id} was not resolved`); // the bridge refuses unknown ids first
    const says = c.says ?? claim.value;
    return {
      url: s.url,
      host: s.host,
      title: s.title,
      via: s.via,
      ...(c.says !== undefined ? { says: c.says } : {}),
      primary: c.primary === true,
      matched: !valueKind || (says !== undefined && sourceSays(s.text, claim.kind, says)),
    };
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

  const publishers = unique(usable.map((s) => publisherOf(s.host)));
  const primary = usable.some((s) => s.primary && !AGGREGATORS.includes(publisherOf(s.host)));
  if (publishers.length >= 2 || primary) return { ...base, status: "confirmed" };
  return { ...base, status: "could-not-verify", check: `Only one source: ${publishers[0]}` };
}
