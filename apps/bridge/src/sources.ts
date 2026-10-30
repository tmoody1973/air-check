import { randomInt } from "node:crypto";
import type { ResolvedSource } from "@aircheck/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * The source ledger (Plan 7): every URL Crate or Tavily returns gets a short random id plus the text that came with it.
 * research_submit may cite only ids issued here. Ids are random, so one from before a bridge restart is unknown, never
 * re-used. In memory only: nothing here is logged or written to disk (Hard Rule 8).
 */
export interface SourceLedger {
  add(s: ResolvedSource): string;
  get(id: string): ResolvedSource | undefined;
}

/** core's LIMITS.sourceText (the bridge ships without core at runtime; a test pins them equal). */
export const SOURCE_TEXT_MAX = 8_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Old text plus new, capped. The newer text keeps at least half the room, so a later snippet that shows a date fits. */
function merge(old: string, add: string): string {
  if (old.includes(add)) return old;
  const keep = Math.max(SOURCE_TEXT_MAX / 2, SOURCE_TEXT_MAX - 1 - add.length);
  return `${old.slice(0, keep)}\n${add}`.slice(0, SOURCE_TEXT_MAX);
}

export function createSourceLedger(opts: { ttlMs?: number; max?: number } = {}): SourceLedger {
  const ttl = opts.ttlMs ?? DAY_MS;
  const max = opts.max ?? 20_000;
  // Map order is last-touched order, so the oldest entry is always first.
  const byId = new Map<string, { source: ResolvedSource; at: number }>();
  const byUrl = new Map<string, string>();

  const drop = (id: string) => {
    const e = byId.get(id);
    byId.delete(id);
    if (e) byUrl.delete(e.source.url);
  };
  const live = (id: string) => {
    const e = byId.get(id);
    if (e && Date.now() - e.at >= ttl) return void drop(id);
    return e;
  };
  const newId = () => {
    let id: string;
    do id = `S${Array.from({ length: 5 }, () => BASE36[randomInt(36)]).join("")}`;
    while (byId.has(id));
    return id;
  };

  return {
    add(s) {
      for (const [id, e] of byId) {
        if (Date.now() - e.at < ttl) break;
        drop(id);
      }
      const known = byUrl.get(s.url);
      const old = known ? live(known) : undefined;
      if (known && old) {
        byId.delete(known);
        byId.set(known, { source: { ...old.source, title: old.source.title || s.title, text: merge(old.source.text, s.text) }, at: Date.now() });
        return known;
      }
      const id = newId();
      byId.set(id, { source: { ...s, text: s.text.slice(0, SOURCE_TEXT_MAX) }, at: Date.now() });
      byUrl.set(s.url, id);
      while (byId.size > max) drop(byId.keys().next().value!);
      return id;
    },
    get: (id) => live(id)?.source,
  };
}

/** Longer URLs are skipped: no real page needs more, and the ledger and the agent's text stay small. */
export const MAX_URL = 2_048;
const TRAILING = new Set([".", ",", ";", ":", "!", "?"]);
const count = (s: string, c: string) => s.split(c).length - 1;

/** Every http(s) URL in `text`, once each, as written, minus trailing punctuation and an unbalanced closing paren. */
export function urlsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>`{}|\\^[\]]+/gi)) {
    const raw = m[0];
    // One backward pass, not a `[.,]+$` pattern: that one is quadratic on a long run of dots.
    const open = count(raw, "(");
    let close = count(raw, ")");
    let end = raw.length;
    for (; end > 0; end--) {
      const ch = raw[end - 1]!;
      if (ch === ")" && open < close) close--;
      else if (!TRAILING.has(ch)) break;
    }
    const u = raw.slice(0, end);
    if (u.length <= MAX_URL && URL.canParse(u)) out.add(u);
  }
  return [...out];
}

export const musicBrainzUrl = (entity: string, mbid: string) => `https://musicbrainz.org/${entity}/${mbid}`;

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The last entity a tool names is what it lists: musicbrainz_get_artist_releases lists releases.
const MB_ENTITY = /release[_-]group|artist|release|label|recording|work/g;
const mbEntity = (tool: string) => tool.match(MB_ENTITY)?.at(-1)?.replace(/_/g, "-");

/**
 * R8b: each allowlisted Crate family's own publisher. Only its pages get ids; a link to anyone else inside a Crate
 * result is the family's text about that page, not that page, so it gets none (the agent can source_search it).
 */
const FAMILY_HOSTS: Record<string, (host: string) => boolean> = {
  musicbrainz: (h) => h === "musicbrainz.org" || h === "www.musicbrainz.org",
  wikipedia: (h) => h === "wikipedia.org" || h.endsWith(".wikipedia.org"),
  bandcamp: (h) => h === "bandcamp.com" || h.endsWith(".bandcamp.com"),
  itunes: (h) => h === "apple.com" || h.endsWith(".apple.com"),
};
const ASSET = /\.(?:jpe?g|png|gif|webp|svg|ico|mp3|m4a|aac|wav|flac|ogg|mp4|m4v|mov)$/i;
/** A family's own page: its host, and never an image or audio file. */
function familyPage(family: string, url: string): boolean {
  const own = FAMILY_HOSTS[family];
  if (!own || !URL.canParse(url) || url.length > MAX_URL) return false;
  const u = new URL(url);
  return ["http:", "https:"].includes(u.protocol) && own(u.hostname.toLowerCase()) && !ASSET.test(u.pathname);
}
/** The one page field of a JSON item, first present: Bandcamp's `url`, then iTunes' store pages. */
const PAGE_FIELDS = ["url", "collectionViewUrl", "trackViewUrl", "artistViewUrl"];
const NAME_FIELDS = ["title", "name", "collectionName", "trackName"];
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A JSON result's items, so each source keeps its own item's text: an array's elements, or a search wrapper's listed
 * items (`{ count, releases: [...] }`, MusicBrainz's own shape). Anything else is one item.
 * ponytail: shapes assumed from the public APIs until plan Task 2 Step 1 records Crate's real result shapes on the VM.
 */
function itemsOf(text: string): unknown[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return [text];
  }
  if (Array.isArray(v)) return v;
  if (isObj(v) && !("id" in v)) {
    const listed = Object.values(v).filter(Array.isArray).flat();
    if (listed.length) return listed;
  }
  return [v];
}

/** Exactly one page per JSON item; for plain text, every family page in it. */
function pagesOf(family: string, tool: string, item: unknown, text: string): string[] {
  if (!isObj(item)) return typeof item === "string" ? urlsIn(text).filter((u) => familyPage(family, u)) : [];
  const entity = family === "musicbrainz" ? mbEntity(tool) : undefined;
  if (entity && typeof item.id === "string" && MBID.test(item.id)) return [musicBrainzUrl(entity, item.id.toLowerCase())];
  const page = PAGE_FIELDS.map((k) => item[k]).find((v): v is string => typeof v === "string");
  return page && familyPage(family, page) ? [page] : [];
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
const MAX_SOURCES_PER_RESULT = 25; // ponytail: a long link list is noise to the agent; raise it if real results need more
const MAX_FACT_LINES = 60;
const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const dateOf = (o: Record<string, unknown>) => (str(o.date) ? o.date : str(o["first-release-date"]) ? o["first-release-date"] : "");
const lengthOf = (o: Record<string, unknown>) => (typeof o.length === "number" ? `length: ${o.length}` : "");

/**
 * Oct 29: a MusicBrainz item's checkable facts as short lines, put before its JSON in the ledger. First its title,
 * credited artists, date and length; then each label-info name and catalog number; then every track or recording with
 * its number, position, date and length (milliseconds, as MusicBrainz gives them). A long release's JSON passes the
 * ledger's 8,000-character cap with its labels and tracks cut off, and its label can sit far from the artist's name
 * (core's 300-character rule), which made the Oct 29 run say "No source shows 4:29 / 2 / Ninja Tune".
 */
function musicBrainzFacts(item: Record<string, unknown>): string {
  const labels = new Set<string>();
  const tracks = new Set<string>();
  const walk = (v: unknown, top: boolean): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, false));
    if (!isObj(v)) return;
    for (const li of Array.isArray(v["label-info"]) ? v["label-info"] : []) {
      if (!isObj(li) || !isObj(li.label) || !str(li.label.name)) continue;
      labels.add(`label: ${li.label.name}${str(li["catalog-number"]) ? ` · catalog ${li["catalog-number"]}` : ""}`);
    }
    if (!top && str(v.title)) {
      const facts = [v.number !== undefined ? `track ${v.number}` : "", v.position !== undefined ? `position ${v.position}` : "", dateOf(v), lengthOf(v)].filter(Boolean);
      if (facts.length) tracks.add([v.title, ...facts].join(" · "));
    }
    for (const [k, x] of Object.entries(v)) if (k !== "label-info") walk(x, false);
  };
  walk(item, true);
  const credited = (Array.isArray(item["artist-credit"]) ? item["artist-credit"] : []).map((c) => (isObj(c) ? c.name : undefined));
  const head = [item.title ?? item.name, ...credited, dateOf(item), lengthOf(item)].filter(str).join(" · ");
  return [head, ...labels, ...tracks].slice(0, MAX_FACT_LINES).join("\n");
}

/** What the ledger keeps for one item (for code's fact check only; the agent never sees it). */
const ledgerText = (family: string, item: unknown) =>
  typeof item === "string" ? item : family === "musicbrainz" && isObj(item) ? `${musicBrainzFacts(item)}\n${JSON.stringify(item)}` : JSON.stringify(item);

/**
 * Crate result hook: each item's own page (or the page built from a MusicBrainz id) is added to the ledger and listed
 * at the end as `Sources:` lines, `[S…] <name> · <host>`. A result with neither gets no ids: it can inform the agent
 * but cannot back a claim.
 */
export function annotateCrateResult(ledger: SourceLedger, tool: string, result: CallToolResult): CallToolResult {
  if (result.isError || !Array.isArray(result.content)) return result;
  const family = tool.split("_")[0]!;
  if (!FAMILY_HOSTS[family]) return result;
  const lines = new Map<string, string>();
  for (const c of result.content) {
    if (c.type !== "text") continue;
    for (const item of itemsOf(c.text)) {
      const text = ledgerText(family, item);
      const name = isObj(item) ? NAME_FIELDS.map((k) => item[k]).find((v): v is string => typeof v === "string" && v.trim() !== "") : undefined;
      for (const url of pagesOf(family, tool, item, text)) {
        if (lines.size >= MAX_SOURCES_PER_RESULT) break;
        const host = new URL(url).hostname.toLowerCase();
        const title = name ? oneLine(name) : "";
        const id = ledger.add({ url, host, title: title || host, via: `crate:${tool}`, text });
        if (!lines.has(id)) lines.set(id, `[${id}] ${title ? `${title} · ` : ""}${host}`);
      }
    }
  }
  if (!lines.size) return result;
  return { ...result, content: [...result.content, { type: "text", text: `Sources:\n${[...lines.values()].join("\n")}` }] };
}
