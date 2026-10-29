import { type ActiveEmbargo, embargoMatches } from "../radar/embargo";
import { formatShowDate } from "../package/title";
import { normalizeValue } from "./judge";
import { trackEmbargo } from "./keys";
import { LIMITS } from "./limits";
import type { CitedSource, DeepDiveView, EmbargoMark, JudgedClaim, ResearchEntry, ShowNotesView, VerifyView, ViewTrack } from "./types";

// Every word and link below is written by code from stored rows; only claim, intro, angle, note and replacement
// sentences (checked by checkResearchText on the way in) come from the model.

const HOUR_WORD = { 1: "One", 2: "Two" } as const;
const RELEASE_KINDS = ["release", "label", "release-date", "track-number", "length"];
const RECENT_DAYS = 14;
const SUPPLIED = "from your supplied notes, which I did not independently check";
const NO_BIO = "I found no verified bio.";
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

type Part = { chunks: string[]; open: string[] };
type Ctx = { view: ShowNotesView; entry: (key: string) => ResearchEntry | undefined; forAgent: boolean };
/** Tarik's edit as written; the agent copy loses any sentence naming an embargoed release (R8). */
const editedText = (text: string, ctx: Ctx) => (ctx.forAgent ? withoutEmbargoed(text, ctx.view.embargoes ?? []) : text);
/** Private-export tag for lines outside the marked block (Pre-Air list, Show Thread); never in the agent copy. */
const privateTag = (t: ViewTrack, ctx: Ctx) => (!ctx.forAgent && trackEmbargo(t, ctx.view.embargoes) ? PRIVATE_TAG : "");

function trackPart(t: ViewTrack, ctx: Ctx): Part {
  const e = ctx.entry(t.key);
  const mark = ctx.forAgent ? null : marker(trackEmbargo(t, ctx.view.embargoes), e?.private !== undefined);
  const chunks = [`## ${t.position}. ${trackLabel(t)}`, ...(mark ? [mark] : [])];
  if (t.closing) return { chunks: [...chunks, "closing-track, no notes"], open: [] };
  if (!e) return { chunks: [...chunks, "_Not researched._"], open: [] };
  const supplied = e.suppliedNote ? [`**Supplied note** (${SUPPLIED}): ${e.suppliedNote}`] : [];
  if (e.edited) return { chunks: [...chunks, ...[editedText(e.edited.text, ctx)].filter(Boolean), ...supplied], open: [] };

  const prefix = `**${t.key} ${trackLabel(t)}:**`;
  const release = e.claims
    .filter((c) => !isVerify(c) && RELEASE_KINDS.includes(c.kind))
    .sort((a, b) => RELEASE_KINDS.indexOf(a.kind) - RELEASE_KINDS.indexOf(b.kind));
  const details = e.claims.filter((c) => c.kind !== "bio" && (isVerify(c) || !RELEASE_KINDS.includes(c.kind)));
  const bios = e.claims.filter((c) => c.kind === "bio");
  const bioBullets = bios.length ? bios.map((c) => (isVerify(c) ? verifyBullet(c) : fact(c))) : [`- **[verify]** ${NO_BIO}`];
  const tag = privateTag(t, ctx);
  const open = [...details, ...bios].filter(isVerify).map((c) => `${prefix} ${checked(c)}${tag}`);
  return {
    chunks: [
      ...chunks,
      ...(release.length ? [withLinks(`**Release:** ${release.map(releaseValue).join(", ")}`, release.flatMap(matched))] : []),
      ...(details.length ? ["### Details:", details.map((c) => (isVerify(c) ? verifyBullet(c) : fact(c))).join("\n")] : []),
      "**Artist:**",
      bioBullets.join("\n"),
      ...(e.note ? [`**Note:** ${e.note}`] : []),
      ...supplied,
      ...(ctx.view.angles && e.angle ? [`**On-air angle:** ${e.angle}`] : []),
    ],
    open: bios.length ? open : [...open, `${prefix} ${NO_BIO}${tag}`],
  };
}

const releaseValue = (c: JudgedClaim) => {
  if (c.kind !== "release-date" || !c.value) return c.value ?? c.text;
  return paperDate(normalizeValue("release-date", c.value) ?? c.value);
};

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
      return [`${withLinks(`${trackLabel(t)} ${when} (${paperDate(iso)})`, matched(c))}${privateTag(t, ctx)}`];
    });
  });
  return items.length ? `- **Release dates:** ${items.join("; ")}` : null;
}

function hourPart(h: 1 | 2, ctx: Ctx): Part {
  const tracks = ctx.view.tracks.filter((t) => t.hour === h);
  const intro = ctx.entry(`H${h}.intro`);
  const threads = ctx.entry(`H${h}.threads`);
  const threadClaims = threads && !threads.edited ? threads.claims : [];
  const bullets = [
    ...(threads?.edited ? [editedText(threads.edited.text, ctx)].filter(Boolean) : threadClaims.map((c) => (isVerify(c) ? verifyBullet(c) : fact(c)))),
    ...[releaseDates(tracks, ctx)].filter((b): b is string => b !== null),
  ];
  const parts = tracks.map((t) => trackPart(t, ctx));
  const open = [...threadClaims.filter(isVerify).map((c) => `**Hour ${HOUR_WORD[h]} threads:** ${checked(c)}`), ...parts.flatMap((p) => p.open)];
  const introText = intro?.edited ? editedText(intro.edited.text, ctx) : intro?.intro;
  return {
    chunks: [
      `# Rhythm Lab Radio, Hour ${HOUR_WORD[h]}: Show Notes`,
      ...(introText ? [introText] : []),
      ...(open.length ? [`${open.length} item${open.length === 1 ? "" : "s"} marked **[verify]** had thin or conflicting sources.`] : []),
      ...(bullets.length ? ["## Show Thread", bullets.join("\n")] : []),
      "----------",
      ...parts.flatMap((p) => p.chunks),
      "----------",
    ],
    open,
  };
}

const entryLookup = (entries: ResearchEntry[]) => {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return (key: string) => byKey.get(key);
};

/**
 * Show notes as Markdown for "Copy for Paper" (fixtures/show-notes-format.md). `forAgent` drops every code-written
 * PRIVATE marker line, for text the agent will read (Plan 8 R8: it never learns which tracks are embargoed).
 */
export function showNotesMarkdown(view: ShowNotesView, opts: { forAgent?: boolean } = {}): string {
  const ctx: Ctx = { view, entry: entryLookup(view.entries), forAgent: opts.forAgent === true };
  const hours = ([1, 2] as const).filter((h) => view.tracks.some((t) => t.hour === h)).map((h) => hourPart(h, ctx));
  const open = hours.flatMap((p) => p.open);
  const chunks = [
    `# Rhythm Lab Radio ${formatShowDate(view.showDate)}`,
    ...hours.flatMap((p) => p.chunks),
    "## Pre-Air Verify List",
    open.length ? open.map((o) => `- ${o}`).join("\n") : "Nothing to verify.",
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
export function verifyReport(view: VerifyView): { changes: { lineId: string; original: string; replacement: string }[]; open: string[] } {
  const entry = entryLookup(view.entries);
  const changes: { lineId: string; original: string; replacement: string }[] = [];
  const open: string[] = [];
  for (const line of view.lines) {
    const e = entry(line.id);
    if (line.closing || !e) continue;
    const cited = e.claims.filter((c) => !isVerify(c)).flatMap(matched);
    // An agent replacement is offered only when every claim on the line holds; otherwise the line stays open.
    const holds = e.claims.length > 0 && !e.claims.some(isVerify);
    const replacement = e.edited?.text ?? (e.replacement && holds ? withLinks(e.replacement, cited) : undefined);
    if (replacement) changes.push({ lineId: line.id, original: line.text, replacement });
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
  const past = !p ? [] : [p.count ? `On Rhythm Lab: ${p.count} show${p.count === 1 ? "" : "s"} in ${p.year}${p.last ? `, last ${paperDate(p.last)}` : ""}` : "No past shows found"];
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
