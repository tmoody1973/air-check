import { type BandcampEmbed, bandcampPageUrl, embedFromPaste } from "./bandcamp";
import { bandcampArtUrl } from "./art";

/**
 * Oct 30: the "Send to Air Check" bookmarklet. It runs in Tarik's own browser on a Bandcamp page he has open, reads the
 * page's player URL, cover, title and address from its meta tags, and opens Air Check's attach page with them in the URL
 * hash (never sent to a server). Air Check itself never fetches Bandcamp: Bandcamp challenges the VM (decision 025).
 */
export function bookmarkletCode(origin: string): string {
  const u = new URL(origin);
  if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error("bookmarkletCode: an https origin");
  const target = `${u.origin}/release-radar/attach#`;
  const js = `(()=>{const m=n=>(document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]')||{}).content||"";const d={player:m("twitter:player")||m("og:video"),art:m("og:image"),title:m("og:title"),page:location.origin+location.pathname};if(!/^https:\\/\\/bandcamp\\.com\\/EmbeddedPlayer\\//.test(d.player)){alert("Air Check: no Bandcamp player on this page.");return}window.open(${JSON.stringify(target)}+encodeURIComponent(JSON.stringify(d)),"_blank")})()`;
  return `javascript:${js}`;
}

export type AttachPayload = { embed: BandcampEmbed; player: string; art?: string; page?: string; title?: string };

/** The bookmarklet's hash, each field checked again; null without a Bandcamp player. Untrusted input (any page can link here). */
export function readAttachPayload(hash: string): AttachPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(hash.replace(/^#/, "")).slice(0, 10_000));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 2_000) : "");
  const player = str(r.player);
  const embed = embedFromPaste(player);
  if (!embed) return null;
  const art = bandcampArtUrl(str(r.art)) ?? undefined;
  const page = bandcampPageUrl(str(r.page)) ?? undefined;
  // Bandcamp's og:title is "<Title>, by <Artist>"; the title alone is what the radar search needs.
  const title = str(r.title).replace(/, by [^,]*$/, "").trim().slice(0, 300) || undefined;
  return { embed, player, ...(art && { art }), ...(page && { page }), ...(title && { title }) };
}
