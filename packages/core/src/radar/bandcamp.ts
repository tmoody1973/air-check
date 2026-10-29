export const BANDCAMP_DOMAIN = "bandcamp.com";

const HOST = /^(?:[a-z0-9-]+\.)*bandcamp\.com$/;
const PAGE_PATH = /^\/(album|track)\/([a-z0-9-]{1,200})$/;

/**
 * The one kind of link anything may fetch (Hard Rule 5's exception, ARCHITECTURE 3.7): a public
 * https://<x>.bandcamp.com/album|track/<slug> page with no credentials, port or query string.
 * Private promo streams carry a key in the query string, so they stay plain links. Returns the canonical URL, or null.
 */
export function bandcampPageUrl(raw: string): string | null {
  const s = raw.trim();
  if (s.includes("?")) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search) return null;
  if (!HOST.test(u.hostname)) return null;
  const m = u.pathname.match(PAGE_PATH);
  return m ? `https://${u.hostname}/${m[1]}/${m[2]}` : null;
}

export type BandcampEmbed = { kind: "album" | "track"; id: string };

const PLAYER_PREFIX = "https://bandcamp.com/EmbeddedPlayer/";
const PLAYER_META = new Set(["og:video", "og:video:secure_url", "twitter:player"]);

// ponytail: regex over <meta> tags, fine for one meta tag on a Bandcamp page. Swap to a parser if a real page breaks it.
/** The album or track id from the page's own player URL. Nothing else from the page is kept. */
export function readBandcampEmbed(html: string): BandcampEmbed | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? "";
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    const content = (attrs.content ?? "").replace(/&amp;/g, "&");
    if (!PLAYER_META.has(key) || !content.startsWith(PLAYER_PREFIX)) continue;
    const path = content.slice(PLAYER_PREFIX.length);
    // A track page's player may also name its album; the track is the one the page is about.
    const m = path.match(/(?:^|\/)(track)=(\d{1,12})(?=\/|$)/) ?? path.match(/(?:^|\/)(album)=(\d{1,12})(?=\/|$)/);
    if (m) return { kind: m[1] as BandcampEmbed["kind"], id: m[2]! };
  }
  return null;
}

/** Bandcamp's player iframe src, built from kind and id only, never from fetched text. */
export function bandcampEmbedSrc(e: BandcampEmbed): string {
  if ((e.kind !== "album" && e.kind !== "track") || !/^\d{1,12}$/.test(e.id)) throw new Error("Not a Bandcamp player id");
  return `${PLAYER_PREFIX}${e.kind}=${e.id}/size=large/bgcol=ffffff/linkcol=0e6a5b/tracklist=false/artwork=small/transparent=true/`;
}
