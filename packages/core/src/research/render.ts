import { type ActiveEmbargo, embargoMatches } from "../radar/embargo";
import { formatShowDate } from "../package/title";
import { normalizeValue } from "./judge";
import { trackEmbargo } from "./keys";
import { LIMITS } from "./limits";
import type { CitedSource, ClaimKind, DeepDiveView, EmbargoMark, JudgedClaim, ResearchEntry, ResearchTrack, ShowNotesView, VerifyView, ViewTrack } from "./types";

// Every word and link below is written by code from stored rows; only claim, intro, angle, note and replacement
// sentences (checked by checkResearchText on the way in) come from the model.

const HOUR_WORD = { 1: "One", 2: "Two" } as const;
const RECENT_DAYS = 14;
const SUPPLIED = "from your supplied notes, which I did not independently check";
const DAY_MS = 86_400_000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PRIVATE_TAG = " · PRIVATE";

const isVerify = (c: JudgedClaim) => c.status === "conflict" || c.status === "could-not-verify";
/** Each source once, by URL. */
const uniqueSources = (sources: CitedSource[]) => [...new Map(sources.map((s) => [s.url, s])).values()];
const links = (sources: CitedSource[]) => uniqueSources(sources).map((s) => `[[${s.host}](${s.url})]`).join(" ");
const withLinks = (text: string, sources: CitedSource[]) => (sources.length ? `${text} ${links(sources)}` : text);
const matched = (c: JudgedClaim) => c.sources.filter((s) => s.matched);
const fact = (c: JudgedClaim) => `- ${withLinks(c.text, matched(c))}`;
const checked = (c: JudgedClaim) => (c.check ? `${c.text} — ${c.check}` : c.text);
const verifyBullet = (c: JudgedClaim) => `- **[verify]** ${withLinks(checked(c), c.sources)}`;
/** Paper-style: "2026-10-16" -> "Oct 16, 2026", "2026-10" -> "Oct 2026"; anything else as written. */
function paperDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return iso;
  const month = MONTH_NAMES[Number(m[2]) - 1];
  return m[3] ? `${month} ${Number(m[3])}, ${m[1]}` : `${month} ${m[1]}`;
}

// Sentence ends, except after an abbreviation such as e.g., Dr. or St.
const ABBREVIATION = /\b(?:e\.g|i\.e|dr|mr|mrs|ms|st|vs|jr|sr)\.$/i;
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    if (out.length && ABBREVIATION.test(out.at(-1)!)) out[out.length - 1] = `${out.at(-1)} ${part}`;
    else out.push(part);
  }
  return out;
}
/** The text without any sentence naming an active embargo's release (D4, R8). Line by line, so Markdown keeps its lines. */
const withoutEmbargoed = (text: string, active: ActiveEmbargo[]) =>
  text
    .split("\n")
    .map((line) => sentences(line).filter((s) => !embargoMatches({ description: s }, active).blocking.length).join(" "))
    .filter((line) => line.trim())
    .join("\n");

const trackLabel = (t: ViewTrack) => `${t.artist} – "${t.title}"${t.feat ? ` feat. ${t.feat}` : ""}`;

function marker(embargo: EmbargoMark | undefined, isPrivate: boolean): string | null {
  if (embargo) return embargo.until ? `**PRIVATE · embargoed until ${paperDate(embargo.until)}**` : "**PRIVATE · embargoed (date not known)**";
  return isPrivate ? "**PRIVATE**" : null;
}

const entryLookup = (entries: ResearchEntry[]) => {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return (key: string) => byKey.get(key);
};

// ---- show notes, shaped like Tarik's Paper notes (Oct 29) ----

type Section = "Album and label" | "Chart" | "Artist bio" | "Story" | "Song" | "Samples and connections" | "Video" | "Fun fact";
/** Each kind's labeled bullet. A Record, so a kind added in types.ts fails the typecheck until it has one. */
const SECTION_OF: Record<ClaimKind, Section> = {
  release: "Album and label", label: "Album and label", "release-date": "Album and label", "track-number": "Album and label", length: "Album and label",
  credit: "Album and label", chart: "Chart", bio: "Artist bio", story: "Story", song: "Song", detail: "Song",
  samples: "Samples and connections", connection: "Samples and connections", thread: "Samples and connections", video: "Video", "fun-fact": "Fun fact",
};
const SECTION_ORDER: readonly Section[] = ["Album and label", "Chart", "Artist bio", "Story", "Song", "Samples and connections", "Video", "Fun fact"];
/** Fewer facts that hold than this, and a track reads as his "What I could verify / What I couldn't verify" pair. */
const THIN_BELOW = 2;
const REVIEW_TOPIC_CHARS = 80;

/** His short link names: the host without www. and without its last label (en.wikipedia.org -> en.wikipedia). */
export const shortHost = (host: string) => host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "").replace(/\.[^.]+$/, "");
/** What a sentence links: the sources that showed it, or for a [verify] fact every source it cited, to check. */
export const linkedSources = (c: JudgedClaim) => uniqueSources(isVerify(c) ? c.sources : matched(c));
const shownValue = (c: JudgedClaim, value: string) => (c.kind === "release-date" ? paperDate(normalizeValue("release-date", value) ?? value) : value);
const conflictValues = (c: JudgedClaim) => [...new Set([...(c.value ? [c.value] : []), ...matched(c).map((s) => s.says ?? c.value ?? "")].filter(Boolean).map((v) => shownValue(c, v)))];

/** For a conflict: "Sources disagree: en.wikipedia says Nov 2, 2017, instagram says Aug 3, 2017." Else null. */
export function disagreement(c: JudgedClaim): string | null {
  if (c.status !== "conflict") return null;
  const said = [...new Set(matched(c).map((s) => `${shortHost(s.host)} says ${shownValue(c, s.says ?? c.value ?? "")}`))];
  return said.length ? `Sources disagree: ${said.join(", ")}.` : null;
}

/** One labeled bullet: `lead` is code's own sentence, before the claims. */
export interface NoteBullet { label: string; lead?: string; claims: JudgedClaim[] }

/**
 * A track's bullets in his Paper order, claims of one kind joined in one bullet. A track with little that holds gets his
 * "What I could verify" / "What I couldn't verify" pair instead, naming the basics not found.
 */
export function noteBullets(claims: JudgedClaim[]): NoteBullet[] {
  const holds = claims.filter((c) => !isVerify(c));
  if (holds.length >= THIN_BELOW) {
    return SECTION_ORDER.map((label) => ({ label, claims: claims.filter((c) => SECTION_OF[c.kind] === label) })).filter((b) => b.claims.length);
  }
  const has = (kinds: ClaimKind[]) => holds.some((c) => kinds.includes(c.kind));
  const gaps = [...(has(["release", "label", "release-date"]) ? [] : ["the album and label"]), ...(has(["bio"]) ? [] : ["the artist's bio"])];
  const couldNot: NoteBullet = { label: "What I couldn't verify", ...(gaps.length && { lead: `I couldn't confirm ${gaps.join(" or ")}.` }), claims: claims.filter(isVerify) };
  return [
    { label: "What I could verify", ...(holds.length ? {} : { lead: "Nothing yet." }), claims: holds },
    ...(couldNot.lead || couldNot.claims.length ? [couldNot] : []),
  ];
}

/** A flag in Notes for Your Review: the sentence (cut at a word near 80 characters) and code's reason. */
function reviewItem(c: JudgedClaim): string {
  const text = c.text.trim().replace(/[.!?]+$/, "");
  const cut = text.length <= REVIEW_TOPIC_CHARS ? text : `${text.slice(0, text.lastIndexOf(" ", REVIEW_TOPIC_CHARS) > 0 ? text.lastIndexOf(" ", REVIEW_TOPIC_CHARS) : REVIEW_TOPIC_CHARS)}…`;
  const reason = c.status === "conflict" ? `sources disagree: ${conflictValues(c).join(" vs ")}` : (c.check ?? "check this").replace(/\.$/, "").replace(/^./, (x) => x.toLowerCase());
  return `${cut} (${reason})`;
}

/** One bullet per hour thread or track with flags, in document order (Notes for Your Review). Edited and closing blocks have none. */
export interface ReviewNote { key: string; name: string; items: string[] }
export function reviewNotes(tracks: ResearchTrack[], entries: ResearchEntry[]): ReviewNote[] {
  const entry = entryLookup(entries);
  const flagged = (key: string, name: string): ReviewNote[] => {
    const e = entry(key);
    const items = e && !e.edited ? e.claims.filter(isVerify).map(reviewItem) : [];
    return items.length ? [{ key, name, items }] : [];
  };
  return ([1, 2] as const).flatMap((h) => [
    ...flagged(`H${h}.threads`, `Hour ${HOUR_WORD[h]} thread`),
    ...tracks.filter((t) => t.hour === h && !t.closing).flatMap((t) => flagged(t.key, noteName(t))),
  ]);
}

/** `Artist, "Title"` as his track headings write it. */
export const noteName = (t: { artist: string; title: string; feat?: string }) => `${t.artist}, "${t.title}"${t.feat ? ` feat. ${t.feat}` : ""}`;

/** A sentence as Paper shows it: the text, a conflict's two versions, its links, then **[verify]** if it needs checking. */
function noteSentence(c: JudgedClaim): string {
  const links = linkedSources(c).map((s) => `[[${shortHost(s.host)}](${s.url})]`).join("");
  const conflict = disagreement(c);
  return `${c.text}${conflict ? ` ${conflict}` : ""}${links}${isVerify(c) ? " **[verify]**" : ""}`;
}
const prose = (lead: string | undefined, claims: JudgedClaim[]) => [...(lead ? [lead] : []), ...claims.map(noteSentence)].join(" ");

type Ctx = { view: ShowNotesView; entry: (key: string) => ResearchEntry | undefined; forAgent: boolean };
/** Tarik's edit as written; the agent copy loses any sentence naming an embargoed release (R8). */
const editedText = (text: string, ctx: Ctx) => (ctx.forAgent ? withoutEmbargoed(text, ctx.view.embargoes ?? []) : text);
/** Private-export tag for lines outside the marked block (review notes, release dates); never in the agent copy. */
const privateTag = (t: ViewTrack, ctx: Ctx) => (!ctx.forAgent && trackEmbargo(t, ctx.view.embargoes) ? PRIVATE_TAG : "");

function trackChunks(t: ViewTrack, ctx: Ctx): string[] {
  const e = ctx.entry(t.key);
  const mark = ctx.forAgent ? null : marker(trackEmbargo(t, ctx.view.embargoes), e?.private !== undefined);
  const head = [`### ${t.position}. ${noteName(t)}`, ...(mark ? [mark] : [])];
  if (t.closing) return [...head, "closing-track, no notes"];
  const supplied = e?.suppliedNote ? [`- **Supplied note** (${SUPPLIED}): ${e.suppliedNote}`] : [];
  if (e?.edited) return [...head, ...[editedText(e.edited.text, ctx)].filter(Boolean), ...supplied];
  if (!e || (!e.claims.length && !e.note)) return [...head, "_Not researched._", ...(supplied.length ? [supplied.join("")] : [])];
  const bullets = [
    ...noteBullets(e.claims).map((b) => `- **${b.label}:** ${prose(b.lead, b.claims)}`),
    ...(e.note ? [`- **Note:** ${e.note}`] : []),
    ...(ctx.view.angles && e.angle ? [`- **On-air angle:** ${e.angle}`] : []),
    ...supplied,
  ];
  return [...head, bullets.join("\n")];
}

/** "released N days before the show", N from code, for confirmed full dates up to RECENT_DAYS before the show. */
function releaseDates(tracks: ViewTrack[], ctx: Ctx): string | null {
  const items = tracks.flatMap((t) => {
    const e = ctx.entry(t.key);
    if (t.closing || !e || e.edited) return [];
    return e.claims.flatMap((c) => {
      const iso = c.kind === "release-date" && c.status === "confirmed" && c.value ? normalizeValue("release-date", c.value) : null;
      if (!iso || iso.length !== 10) return [];
      const days = Math.round((Date.parse(ctx.view.showDate) - Date.parse(iso)) / DAY_MS);
      if (days < 0 || days > RECENT_DAYS) return [];
      const when = days === 0 ? "released the day of the show" : `released ${days} day${days === 1 ? "" : "s"} before the show`;
      const links = matched(c).map((s) => `[[${shortHost(s.host)}](${s.url})]`).join("");
      return [`${noteName(t)} ${when} (${paperDate(iso)})${links}${privateTag(t, ctx)}`];
    });
  });
  return items.length ? `**Release dates:** ${items.join("; ")}` : null;
}

function hourChunks(h: 1 | 2, ctx: Ctx): string[] {
  const tracks = ctx.view.tracks.filter((t) => t.hour === h);
  const intro = ctx.entry(`H${h}.intro`);
  const threads = ctx.entry(`H${h}.threads`);
  const introText = intro?.edited ? editedText(intro.edited.text, ctx) : intro?.intro;
  const thread = threads?.edited ? editedText(threads.edited.text, ctx) : threads?.claims.length ? prose(undefined, threads.claims) : "";
  return [
    `# Rhythm Lab Radio, Hour ${HOUR_WORD[h]}: Show Notes`,
    ...(introText ? [introText] : []),
    ...(thread ? [`**Hour thread:** ${thread}`] : []),
    ...[releaseDates(tracks, ctx)].filter((b): b is string => b !== null),
    ...tracks.flatMap((t) => trackChunks(t, ctx)),
  ];
}

/**
 * Show notes as Markdown for "Copy for Paper" (fixtures/show-notes-format.md), shaped like his Oct 23 Paper notes.
 * `forAgent` drops every code-written PRIVATE marker, for text the agent will read (Plan 8 R8: it never learns which
 * tracks are embargoed).
 */
export function showNotesMarkdown(view: ShowNotesView, opts: { forAgent?: boolean } = {}): string {
  const ctx: Ctx = { view, entry: entryLookup(view.entries), forAgent: opts.forAgent === true };
  const hours = ([1, 2] as const).filter((h) => view.tracks.some((t) => t.hour === h));
  const tag = (key: string) => {
    const t = view.tracks.find((x) => x.key === key);
    return t ? privateTag(t, ctx) : "";
  };
  const review = reviewNotes(view.tracks, view.entries).map((r) => `- **${r.name}:** ${r.items.join("; ")}.${tag(r.key)}`);
  const chunks = [
    `# Rhythm Lab Radio ${formatShowDate(view.showDate)}`,
    ...hours.flatMap((h) => hourChunks(h, ctx)),
    "## Notes for Your Review",
    review.length ? review.join("\n") : "Nothing to verify.",
  ];
  return `${chunks.join("\n\n")}\n`;
}

/**
 * Plain text for the package draft's NOTES: confirmed and sourced claims only. No private, edited or embargoed
 * block, no angle, note or supplied note, and no sentence that names an active embargo's release (D4).
 */
export function notesForDraft(view: ShowNotesView): string {
  const active = view.embargoes ?? [];
  const entry = entryLookup(view.entries);
  const safe = (text: string) => withoutEmbargoed(text, active);
  const facts = (e: ResearchEntry | undefined) =>
    !e || e.edited || e.private ? [] : e.claims.filter((c) => !isVerify(c) && c.kind !== "connection").map((c) => safe(c.text)).filter(Boolean);
  const lines = ([1, 2] as const).flatMap((h) => [
    ...facts(entry(`H${h}.threads`)),
    ...view.tracks
      .filter((t) => t.hour === h && !t.closing && !trackEmbargo(t, active))
      .flatMap((t) => {
        const f = facts(entry(t.key));
        return f.length ? [`${trackLabel(t)}: ${f.join(" ")}`] : [];
      }),
  ]);
  return lines.join("\n");
}

/** Replacements for the notes (original verbatim, links appended by code) and every check still open. */
/** One offered change: `replacement` is the exact Paper Markdown (links appended); `text` and `sources` are its parts. */
export interface VerifyChange { lineId: string; original: string; replacement: string; text: string; sources: CitedSource[] }

export function verifyReport(view: VerifyView): { changes: VerifyChange[]; open: string[] } {
  const entry = entryLookup(view.entries);
  const changes: VerifyChange[] = [];
  const open: string[] = [];
  for (const line of view.lines) {
    const e = entry(line.id);
    if (line.closing || !e) continue;
    const cited = e.claims.filter((c) => !isVerify(c)).flatMap(matched);
    // An agent replacement is offered only when every claim on the line holds; otherwise the line stays open.
    const holds = e.claims.length > 0 && !e.claims.some(isVerify);
    const replacement = e.edited?.text ?? (e.replacement && holds ? withLinks(e.replacement, cited) : undefined);
    const text = e.edited?.text ?? e.replacement ?? "";
    const sources = e.edited ? [] : uniqueSources(cited);
    if (replacement) changes.push({ lineId: line.id, original: line.text, replacement, text, sources });
    open.push(...e.claims.filter(isVerify).map((c) => `${line.id}: ${checked(c)}`));
  }
  return { changes, open };
}

/** A deep-dive brief: facts, connections by track name, what could not be verified, and the code-written past shows. */
export function deepDiveMarkdown(view: DeepDiveView): string {
  const e = view.entry;
  const claims = e && !e.edited ? e.claims : [];
  const mark = marker(view.embargo, e?.private !== undefined);
  const tracks = new Map(view.tracks.filter((t) => !t.closing).map((t) => [t.key, t]));
  const facts = claims.filter((c) => !isVerify(c) && c.kind !== "connection").map(fact);
  const connects = claims
    .filter((c) => !isVerify(c) && c.kind === "connection" && c.value !== undefined && tracks.has(c.value))
    .slice(0, LIMITS.connectsMax)
    .map((c) => `- **${trackLabel(tracks.get(c.value!)!)}:** ${withLinks(c.text, matched(c))}`);
  const unverified = claims.filter(isVerify).map(verifyBullet);
  const p = view.pastShows;
  // R10 (Hard Rule 10): a zero cannot be known (missing tracklists, the year's first weeks), so only a count is said.
  const past = p && p.count > 0 ? [`On Rhythm Lab: ${p.count} show${p.count === 1 ? "" : "s"} in ${p.year}${p.last ? `, last ${paperDate(p.last)}` : ""}`] : [];
  const chunks = [
    `# Deep dive: ${view.subject.name}`,
    ...(mark ? [mark] : []),
    ...(e?.edited ? [e.edited.text] : []),
    ...(facts.length ? [facts.join("\n")] : []),
    ...(connects.length ? ["## Connects to your list", connects.join("\n")] : []),
    ...(unverified.length ? ["## Could not verify", unverified.join("\n")] : []),
    ...(e?.note ? [`**Note:** ${e.note}`] : []),
    ...past,
  ];
  return `${chunks.join("\n\n")}\n`;
}
