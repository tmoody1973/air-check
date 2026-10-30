import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { readCapped } from "./tavily.js";

/**
 * The one Apple Music API client (Plan 7, ruling R6). Catalog search only: release date, label, ℗ line, UPC/ISRC and
 * the music.apple.com page. Never audio, previews or artwork (Hard Rule 13). The MusicKit key lives on the VM for the
 * bridge only; the agent never holds it (Hard Rule 2). Nothing here logs a key, token, query or URL (Hard Rule 8).
 */
export const APPLE_MUSIC_SEARCH_URL = "https://api.music.apple.com/v1/catalog/us/search";
/** Apple's ceiling for exp - iat (developer.apple.com, generating-developer-tokens, checked via Context7 Oct 29). */
export const MAX_TOKEN_LIFETIME_S = 15_777_000;
const TOKEN_LIFETIME_S = 12 * 60 * 60;
const REFRESH_BEFORE_S = 60 * 60;
const MAX_RESULTS = 5;
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 262_144; // ten catalog items are a few KB
const MAX_LINE = 2_000; // one catalog line; far under core's LIMITS.sourceText
const PAGE_HOST = "music.apple.com";

export interface AppleMusicConfig {
  teamId: string;
  keyId: string;
  keyFile: string;
}
export interface AppleMusicKey {
  teamId: string;
  keyId: string;
  key: KeyObject;
}
export interface CatalogResult {
  url: string;
  title: string;
  text: string;
}
export interface AppleMusic {
  search(term: string): Promise<CatalogResult[]>;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A MusicKit developer token: ES256 JWT, raw r||s signature (JOSE), not DER. */
export function appleMusicToken(k: AppleMusicKey, nowS: number, lifetimeS = TOKEN_LIFETIME_S): string {
  const input = `${b64({ alg: "ES256", kid: k.keyId })}.${b64({ iss: k.teamId, iat: nowS, exp: nowS + Math.min(lifetimeS, MAX_TOKEN_LIFETIME_S) })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: k.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 300) : "");

/** The ledger text for one catalog item, built by code from Apple's own fields only. */
export function catalogLine(a: Record<string, unknown>): string {
  const [name, artist, album, date, label, copyright, upc, isrc] = ["name", "artistName", "albumName", "releaseDate", "recordLabel", "copyright", "upc", "isrc"].map((k) => str(a[k]));
  const head = `Apple Music: "${name}"${artist ? ` by ${artist}` : ""}`;
  const parts = [head, album && `from "${album}"`, date && `released ${date}`, label && `label ${label}`, copyright, upc && `UPC ${upc}`, isrc && `ISRC ${isrc}`];
  return parts.filter(Boolean).join(" · ").slice(0, MAX_LINE);
}

function pageOf(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2_048 || !URL.canParse(v)) return null;
  const u = new URL(v);
  return u.protocol === "https:" && u.hostname.toLowerCase() === PAGE_HOST ? v : null;
}

function itemsOf(group: unknown): CatalogResult[] {
  const data = (group as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const a = (item as { attributes?: unknown } | null)?.attributes;
    if (!a || typeof a !== "object") return [];
    const attrs = a as Record<string, unknown>;
    const url = pageOf(attrs.url);
    if (!url) return [];
    return [{ url, title: `"${str(attrs.name)}"${str(attrs.artistName) ? ` by ${str(attrs.artistName)}` : ""}`, text: catalogLine(attrs) }];
  });
}

export function createAppleMusic(k: AppleMusicKey, opts: { fetch?: typeof fetch; now?: () => number } = {}): AppleMusic {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { token: string; refreshAt: number } | undefined;
  const token = () => {
    const s = Math.floor(now() / 1000);
    if (!cached || s >= cached.refreshAt) cached = { token: appleMusicToken(k, s), refreshAt: s + TOKEN_LIFETIME_S - REFRESH_BEFORE_S };
    return cached.token;
  };

  return {
    /** Throws a plain-sentence Error on a non-200, a timeout or an unreadable answer; never echoes the token or body. */
    async search(term) {
      const url = `${APPLE_MUSIC_SEARCH_URL}?${new URLSearchParams({ term, types: "albums,songs", limit: String(MAX_RESULTS) })}`;
      let res: Response;
      try {
        res = await doFetch(url, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        throw new Error(e instanceof Error && e.name === "TimeoutError" ? "Apple Music lookup timed out." : "Apple Music could not be reached.");
      }
      if (res.status !== 200) throw new Error(`Apple Music lookup failed (HTTP ${res.status}).`);
      let results: unknown;
      try {
        const raw = await readCapped(res, MAX_BODY_BYTES);
        results = raw === null ? undefined : (JSON.parse(raw) as { results?: unknown } | null)?.results;
      } catch {
        results = undefined;
      }
      if (!results || typeof results !== "object") throw new Error("Apple Music gave an unreadable answer.");
      const r = results as { albums?: unknown; songs?: unknown };
      // Albums first: they carry the label and the ℗ line.
      return [...itemsOf(r.albums), ...itemsOf(r.songs)].slice(0, MAX_RESULTS);
    },
  };
}

/** The bridge's Apple Music client, or undefined (unconfigured or unreadable key): the tool then says it is unavailable. */
export function loadAppleMusic(cfg: AppleMusicConfig | undefined, opts: { fetch?: typeof fetch } = {}): AppleMusic | undefined {
  if (!cfg) return undefined;
  let key: KeyObject;
  try {
    key = createPrivateKey(readFileSync(cfg.keyFile));
  } catch {
    console.error("apple_music=unavailable reason=key_unreadable"); // never the path or the key
    return undefined;
  }
  // MusicKit tokens are ES256: a key on any other curve or type would sign tokens Apple refuses on every call.
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    console.error("apple_music=unavailable reason=key_not_p256");
    return undefined;
  }
  console.log("apple_music=available");
  return createAppleMusic({ teamId: cfg.teamId, keyId: cfg.keyId, key }, opts);
}
