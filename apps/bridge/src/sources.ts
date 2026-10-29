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
export const SOURCE_TEXT_MAX = 2_000;
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
    if (URL.canParse(u)) out.add(u);
  }
  return [...out];
}

export const musicBrainzUrl = (entity: string, mbid: string) => `https://musicbrainz.org/${entity}/${mbid}`;

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// First match wins, so release_group comes before release.
const MB_ENTITIES: [RegExp, string][] = [
  [/release[_-]group/, "release-group"],
  [/artist/, "artist"],
  [/release/, "release"],
  [/label/, "label"],
  [/recording/, "recording"],
  [/work/, "work"],
];
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A JSON result's items, so each source keeps its own item's text: an array's elements, or a search wrapper's listed
 * items (`{ count, releases: [...] }`, MusicBrainz's own shape). Anything else is one item.
 * ponytail: shapes assumed from MusicBrainz's API until plan Task 2 Step 1 records Crate's real result shapes on the VM.
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

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
const MAX_SOURCES_PER_RESULT = 25; // ponytail: a long link list is noise to the agent; raise it if real results need more

/**
 * Crate result hook: every URL in an allowlisted Crate tool's result (or built from a MusicBrainz id) is added to the
 * ledger and listed at the end as `Sources:` lines, `[S…] <name> · <host>`. A result with neither gets no ids: it can
 * inform the agent but cannot back a claim.
 */
export function annotateCrateResult(ledger: SourceLedger, tool: string, result: CallToolResult): CallToolResult {
  if (result.isError || !Array.isArray(result.content)) return result;
  const entity = tool.startsWith("musicbrainz_") ? MB_ENTITIES.find(([re]) => re.test(tool))?.[1] : undefined;
  const lines = new Map<string, string>();
  for (const c of result.content) {
    if (c.type !== "text") continue;
    for (const item of itemsOf(c.text)) {
      const text = typeof item === "string" ? item : JSON.stringify(item);
      const name = isObj(item) ? [item.title, item.name].find((v): v is string => typeof v === "string" && v.trim() !== "") : undefined;
      const mbid = entity && isObj(item) && typeof item.id === "string" && MBID.test(item.id) ? musicBrainzUrl(entity, item.id.toLowerCase()) : undefined;
      for (const url of [...(mbid ? [mbid] : []), ...urlsIn(text)]) {
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
