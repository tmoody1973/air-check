// Cover art rules: an address only, never the image. Nothing in Air Check fetches a cover; Tarik's browser loads it
// (lazy, no referrer). Decision 027 adds the two Mailchimp image hosts that co-sign roundups use.

const MAX_ART_CHARS = 500;
const ART_HOST = /^(?:[a-z0-9-]{1,63}\.){1,4}bcbits\.com$/;
const ART_PATH = /^\/img\/[A-Za-z0-9_-]{1,100}\.(?:jpe?g|png|gif|webp)$/i;
// Mailchimp's own image hosts, exact names only: mcusercontent.com (uploads since 2019) and gallery.mailchimp.com (older
// uploads). Both serve an image as /<account>/images/<file> (or /_compresseds/), without any query.
const MAILCHIMP_HOSTS = new Set(["mcusercontent.com", "gallery.mailchimp.com"]);
const MAILCHIMP_PATH = /^\/[A-Za-z0-9]{8,64}\/(?:images|_compresseds)\/[A-Za-z0-9_.%-]{1,200}\.(?:jpe?g|png|gif|webp)$/i;
// A spacer or an open-tracking image by name.
const TRACKING_NAME = /spacer|pixel|beacon|\/track\/|\/open\b/i;

/** Cover art: an https image on a *.bcbits.com host (no query, port or credentials), else null. The URL only, never the image. */
export function bandcampArtUrl(raw: string): string | null {
  if (raw.length > MAX_ART_CHARS || raw.includes("?") || raw.includes("#")) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !ART_HOST.test(u.hostname) || !ART_PATH.test(u.pathname)) return null;
  const art = `https://${u.hostname}${u.pathname}`;
  return art === raw ? art : null;
}

/**
 * Decision 027: a cover a release card may show, from Bandcamp's image host or Mailchimp's. https only, no credentials or
 * port; the query and fragment are dropped (these hosts serve the image without them, and a query can carry tracking).
 * The bare address, or null.
 */
export function coverArtUrl(raw: string): string | null {
  if (raw.length > MAX_ART_CHARS) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const bare = `https://${u.hostname}${u.pathname}`;
  if (bandcampArtUrl(bare) === bare) return bare;
  return MAILCHIMP_HOSTS.has(u.hostname) && MAILCHIMP_PATH.test(u.pathname) && !TRACKING_NAME.test(u.pathname) ? bare : null;
}
