import { coverArtUrl } from "./art";
import { BANDCAMP_DOMAIN, bandcampPageUrl } from "./bandcamp";

/** As much of an AgentMail message as the radar reads. Attachments are counted, never read. */
export interface InboundMail {
  messageId: string;
  from: string;
  subject: string;
  text: string;
  hrefs: string[];
  /** The raw HTML part, read again by cleanMail for covers (decision 027) once the sender is confirmed. */
  html?: string;
  attachmentCount: number;
  bodyMissing: boolean;
}

export type RadarTab = "bandcamp" | "cosign";
/**
 * AgentMail's own SPF/DKIM/DMARC verdict on a message and its labels, read from AgentMail's API with our key (R12).
 * Never taken from the email's text or headers: AgentMail strips the raw Authentication-Results header.
 */
export interface SenderVerdict {
  auth: { dmarc?: string; dmarc_domain?: string } | null;
  labels: string[] | null;
}
export type SenderDecision = { ok: true; tab: RadarTab; address: string } | { ok: false; reason: string };
export interface CleanMail {
  tab: RadarTab;
  sender?: { name?: string; address?: string };
  subject: string;
  body: string;
  links: string[];
  /** Decision 027: allowed cover addresses, in order; the body's [image N] is images[N-1]. Left out when there are none. */
  images?: string[];
  bandcampPages: string[];
  hosts: string[];
}

export const MAX_STORED_CHARS = 20_000;
/** A subject is cut to this before it is cleaned (radar.received keeps 200). */
export const MAX_SUBJECT_CHARS = 1_000;
const MAX_NAME_CHARS = 200; // radar.received's field limit
const BODY_MARGIN = 1_000; // the body is cut to its stored limit plus this before cleaning, then to the limit after
const MAX_FROM_CHARS = 998; // RFC 5322's line limit
const MAX_VERDICT_CHARS = 255; // a DMARC result word or a domain name
const MAX_LABELS = 100;
const MAX_LINKS = 20;
export const MAX_IMAGES = 20;
const MAX_LINK_CHARS = 500;
const MAX_PAGES = 3;
const MAX_HOSTS = 3;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * The fields the radar needs from an AgentMail message (`from_` is what arrives on the wire).
 * Never reads `extracted_text`, which can drop the forwarded part. Null with no message id or sender.
 */
export function pickInbound(message: unknown): InboundMail | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const messageId = str(m.message_id)?.trim();
  const from = (str(m.from_) ?? str(m.from))?.trim();
  if (!messageId || !from) return null;
  const html = str(m.html);
  const text = str(m.text);
  const fromHtml = html === undefined ? undefined : htmlToText(html);
  return {
    messageId,
    from,
    subject: str(m.subject) ?? "",
    text: text?.trim() ? text : (fromHtml?.text ?? ""),
    hrefs: fromHtml?.hrefs ?? [],
    ...(html !== undefined && { html }),
    attachmentCount: Array.isArray(m.attachments) ? m.attachments.length : 0,
    bodyMissing: text === undefined && html === undefined, // AgentMail omits both over 1 MB
  };
}

/** `authentication_results` and `labels` from an AgentMail message, shape-checked: anything unexpected is null. */
export function readVerdict(message: unknown): SenderVerdict {
  const m = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
  const a = m.authentication_results;
  const auth =
    a && typeof a === "object" && !Array.isArray(a)
      ? Object.fromEntries(
          (["dmarc", "dmarc_domain"] as const).flatMap((k) => {
            const v = str((a as Record<string, unknown>)[k]);
            return v === undefined ? [] : [[k, v.slice(0, MAX_VERDICT_CHARS)]];
          }),
        )
      : null;
  const l = m.labels;
  const labels = Array.isArray(l) && l.every((x) => typeof x === "string") ? (l as string[]).slice(0, MAX_LABELS) : null;
  return { auth, labels };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? whole;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    // Never the cleaner's own placeholder characters (decision 027): an email cannot forge a marker.
    return code > 0 && code <= 0x10ffff && code !== 0xe000 && code !== 0xe001 ? String.fromCodePoint(code) : whole;
  });
}

const BLOCK_OPEN = /<(script|style|head|title)\b|<!--/g;

/**
 * Script, style, head and title blocks and comments, dropped in one pass with indexOf (a lazy [\s\S]*? regex is
 * quadratic on many unclosed opens). An unclosed block is left in place, as before, and its kind is never searched again.
 */
function dropBlocks(html: string): string {
  const lower = html.toLowerCase();
  const unclosed = new Set<string>();
  let out = "";
  let from = 0;
  BLOCK_OPEN.lastIndex = 0;
  for (let m = BLOCK_OPEN.exec(lower); m; m = BLOCK_OPEN.exec(lower)) {
    const kind = m[1] ?? "!--";
    const close = m[1] ? `</${m[1]}` : "-->";
    const end = unclosed.has(kind) ? -1 : lower.indexOf(close, BLOCK_OPEN.lastIndex);
    if (end < 0) {
      unclosed.add(kind);
      continue;
    }
    const after = m[1] ? lower.indexOf(">", end) : end + 2;
    if (after < 0) {
      unclosed.add(kind);
      continue;
    }
    out += `${html.slice(from, m.index)} `;
    from = after + 1;
    BLOCK_OPEN.lastIndex = from;
  }
  return out + html.slice(from);
}

// ponytail: regex-based, fine for mail bodies. Swap to a parser if a real email breaks it.
/** Plain text and every href from an HTML mail body. Script, style and head are dropped. */
export function htmlToText(html: string): { text: string; hrefs: string[] } {
  const visible = visibleHtml(html);
  const hrefs = [...visible.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((m) => decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim()))
    .filter(Boolean);
  return { text: tagsToText(visible), hrefs };
}

// [^<>] rather than [^>]: an unclosed "<" then scans only to the next tag, so a run of them stays linear.
const visibleHtml = (html: string) => dropBlocks(html).replace(/<(?:link|base)\b[^<>]*>/gi, " ");

function tagsToText(visible: string): string {
  return decodeEntities(
    visible
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:p|div|tr|li|ul|ol|h[1-6]|table|blockquote|section|article|header|footer|hr)\b[^<>]*>/gi, "\n")
      .replace(/<\/?(?:td|th)\b[^<>]*>/gi, " ")
      .replace(/<[^<>]*>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Decision 027: while one email is cleaned, a link or cover is a private-use placeholder (OPEN kind index CLOSE) until
// the final lists are known; then it becomes [link N] or [image N]. Incoming text never holds these two characters.
const OPEN = "\uE000";
const CLOSE = "\uE001";
const PLACEHOLDER_CHARS = /[\uE000\uE001]/g;
const PLACEHOLDER = /\uE000([uai])(\d{1,6})\uE001/g;
const placeholder = (kind: "u" | "a" | "i", i: number) => ` ${OPEN}${kind}${i}${CLOSE} `;
const SRC = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HREF = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
// width="1", height=2 or style="width:1px": 3 or less is a tracking pixel or a spacer.
const SIZE = /(?:\s(?:width|height)\s*=\s*["']?\s*|[\s;"'](?:width|height)\s*:\s*)(\d{1,6})/gi;

const attr = (tag: string, re: RegExp) => {
  const m = re.exec(tag);
  return m ? decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim()) : "";
};
const isPixel = (tag: string) => [...tag.matchAll(SIZE)].some((m) => Number(m[1]) <= 3);

/**
 * The HTML part as text with a placeholder where each link (`<a href>`) and each image was. `imageAt[k]` is image k's
 * cover address when it passes coverArtUrl and is not a pixel, else null; `images` is the distinct kept covers, at most 20.
 */
function markedHtml(html: string): { text: string; anchors: string[]; imageAt: (string | null)[]; images: string[] } {
  const anchors: string[] = [];
  const imageAt: (string | null)[] = [];
  const visible = visibleHtml(html.replace(PLACEHOLDER_CHARS, ""))
    .replace(/<a\b[^<>]*>/gi, (tag) => placeholder("a", anchors.push(attr(tag, HREF)) - 1))
    .replace(/<img\b[^<>]*>/gi, (tag) => placeholder("i", imageAt.push(isPixel(tag) ? null : coverArtUrl(attr(tag, SRC))) - 1));
  const images = [...new Set(imageAt.filter((u): u is string => u !== null))].slice(0, MAX_IMAGES);
  return { text: tagsToText(visible), anchors, imageAt, images };
}

/** Comma-separated, lowercased. Unset parses to nothing: an empty list is a closed door. */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const ADDRESS = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
const MAX_ADDRESS_CHARS = 254; // RFC 5321's path limit; radar.received refuses over 320

/** A plain dotted host name (no port, brackets, underscore or trailing dot). radar.received refuses any other. */
export const HOST_NAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
export const isHostName = (h: string): boolean => h.length <= 253 && HOST_NAME.test(h);

/** "Name <a@b.c>" or "a@b.c" → its parts; the address only when it looks like one. */
function parseFrom(full: string): { name?: string; address?: string } {
  const raw = full.slice(-MAX_FROM_CHARS); // the end: the <address> is last; a long name only bounds the trim's work
  const angle = raw.match(/^(.*?)<([^<>]+)>\s*$/);
  const address = (angle ? angle[2]! : raw).trim().toLowerCase().replace(/^mailto:/, "");
  const name = angle?.[1]?.trim().replace(/^["'*\s]+|["'*\s]+$/g, "");
  return { ...(name ? { name } : {}), ...(address.length <= MAX_ADDRESS_CHARS && ADDRESS.test(address) ? { address } : {}) };
}

/** Whether the From address, parsed, is exactly one on the list. */
export function isListedSender(from: string, allowlist: string[]): boolean {
  const address = parseFrom(from).address;
  return address !== undefined && allowlist.includes(address);
}

/** DMARC relaxed alignment, one way: the From domain is dmarc_domain or a subdomain of it. A dotless domain never aligns. */
function aligned(dmarcDomain: string, from: string): boolean {
  const d = dmarcDomain.trim().toLowerCase();
  // ponytail: public suffixes like co.uk are not special-cased (no allowlisted sender uses one).
  return d.includes(".") && (from === d || from.endsWith(`.${d}`));
}

const BAD_LABELS = ["unauthenticated", "spam", "blocked"];
const NOT_CONFIRMED = "AgentMail could not confirm the sender";

/**
 * Ruling R12: exact address on the allowlist, and AgentMail's verdict (from its API, never the email) is a DMARC pass
 * aligned with the From domain, on a message not labelled unauthenticated, spam or blocked. A From line alone can be faked.
 * The tab is Bandcamp when the mail is from bandcamp.com, or when Tarik forwarded a bandcamp.com email by hand.
 */
export function senderDecision(mail: Pick<InboundMail, "from" | "text">, allowlist: string[], verdict: SenderVerdict | null): SenderDecision {
  if (!isListedSender(mail.from, allowlist)) return { ok: false, reason: "Sender not on the list" };
  const address = parseFrom(mail.from).address!;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  const auth = verdict?.auth;
  const labels = verdict?.labels;
  const confirmed =
    auth?.dmarc === "pass" && auth.dmarc_domain !== undefined && aligned(auth.dmarc_domain, domain) && labels != null && !labels.some((l) => BAD_LABELS.includes(l.toLowerCase()));
  if (!confirmed) return { ok: false, reason: NOT_CONFIRMED };
  const original = unwrapForward(mail.text).sender?.address;
  const bandcamp = domain === BANDCAMP_DOMAIN || original?.endsWith(`@${BANDCAMP_DOMAIN}`);
  return { ok: true, tab: bandcamp ? "bandcamp" : "cosign", address };
}

const FORWARD_MARK = /^[ \t>]*(?:-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:)[ \t]*$/im;
const FORWARD_HEADER = /^(From|Date|Sent|Subject|To|Cc|Reply-To):\s*(.*)$/i;

/** Gmail's and Apple Mail's forward blocks: the original From becomes `sender`, and the note above the block is dropped. */
export function unwrapForward(text: string): { sender?: { name?: string; address?: string }; body: string } {
  const mark = FORWARD_MARK.exec(text);
  if (!mark) return { body: text };
  const lines = text.slice(mark.index + mark[0].length).split("\n");
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  let sender: { name?: string; address?: string } | undefined;
  for (; i < lines.length; i++) {
    const h = lines[i]!.replace(/^[ \t>]*/, "").match(FORWARD_HEADER);
    if (!h) break;
    if (h[1]!.toLowerCase() === "from") sender = parseFrom(h[2]!);
  }
  const body = lines.slice(i).join("\n").trim();
  return sender && (sender.name || sender.address) ? { sender, body } : { body };
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]*/gi; // no \b: "foohttps://…" must not survive
// These run on a public webhook before the sender check, so each must stay linear on a hostile run: every repeat
// before a literal is bounded, "://" and "[.]" are found per word, and addresses are found from each "@" outward.
const WWW_IN_TEXT = /www\.[^\s<>"'`]+/gi;
// Oct 30: plain-text forwards space a site's parts ("www. co-sign. com"); one to eight spaced labels, then the ending.
const SPACED_WWW = /www\.(?:\s{1,3}[\w-]{1,63}\.){1,8}\s{0,3}[a-z]{2,63}\b/gi;
const HOST_PATH = /\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,8}\.[a-z]{2,63}\/\S*/gi; // bit.ly/abc, evil.example/a
const MAILTO = /\bmailto:[^\s<>"'`]*/gi;
const TOKEN = /\S+/g; // any word holding "://" (ftp://, hxxps://) or "[.]" (evil[.]com) becomes [link]: radar.received refuses "://"
const EMAIL_DOMAIN = /[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/y;
const EMAIL_LOCAL = /[\w.+-]/;
const TRAILING = /[.,;:!?)\]}>'"]{1,64}$/;

/** Each local@domain (local at most 64 characters, read back from the "@") becomes [email], in one linear pass. */
function replaceEmails(text: string): string {
  let out = "";
  let from = 0;
  for (let at = text.indexOf("@"); at >= 0; at = text.indexOf("@", at + 1)) {
    let start = at;
    while (start > from && at - start < 64 && EMAIL_LOCAL.test(text[start - 1]!)) start--;
    EMAIL_DOMAIN.lastIndex = at + 1;
    const domain = start < at ? EMAIL_DOMAIN.exec(text) : null;
    if (!domain) continue;
    out += `${text.slice(from, start)}[email]`;
    from = at + 1 + domain[0].length;
    at = from - 1;
  }
  return out + text.slice(from);
}

function httpLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Every http(s) URL and www. host becomes [link], every email address (mailto: too) becomes [email], and any other @
 * becomes (at), so no stored or model-bound text holds one. Up to 20 distinct http(s) links are kept apart for Tarik;
 * the ones that pass bandcampPageUrl (at most 3) are the only links anything may fetch.
 */
export function stripLinks(text: string, hrefs: string[] = []): { text: string; links: string[]; bandcampPages: string[]; hosts: string[] } {
  const { found: _, ...r } = strip(text, hrefs, false);
  return r;
}

type Stripped = ReturnType<typeof stripLinks> & { found: string[] };

/** stripLinks; with `mark`, each http(s) URL becomes a placeholder for found[i] instead of [link] (decision 027). */
function strip(text: string, hrefs: string[], mark: boolean): Stripped {
  const found: string[] = [];
  const toLink = (match: string) => {
    const core = match.replace(TRAILING, "");
    const i = found.push(core) - 1;
    return (mark ? placeholder("u", i).trim() : "[link]") + match.slice(core.length);
  };
  const asLink = (m: string) => "[link]" + m.slice(m.replace(TRAILING, "").length);
  // NFKC first, so fullwidth and small-form look-alikes (ｈttps, ：, ＠, ﹫) become the ASCII the patterns catch.
  const linked = text
    .normalize("NFKC")
    .replace(MAILTO, "[email]")
    .replace(URL_IN_TEXT, toLink)
    .replace(TOKEN, (t) => (t.includes("://") || t.includes("[.]") ? asLink(t) : t))
    .replace(SPACED_WWW, "[link]")
    .replace(WWW_IN_TEXT, asLink)
    .replace(/www\./gi, "[link]"); // any www. left (a bare "www." at a line end) is never stored
  const stripped = replaceEmails(linked).replace(HOST_PATH, asLink).replace(/@/g, "(at)");
  // A link whose host radar.received would refuse (localhost, [::1], foo_bar, a trailing dot) is dropped, not kept for Tarik.
  const links = [...new Set([...found, ...hrefs].map(httpLink).filter((l): l is string => l !== null))]
    .filter((l) => l.length <= MAX_LINK_CHARS && isHostName(new URL(l).hostname))
    .slice(0, MAX_LINKS);
  const pages = links.map((l) => [l, bandcampPageUrl(l)] as const);
  const bandcampPages = [...new Set(pages.flatMap(([, p]) => (p ? [p] : [])))].slice(0, MAX_PAGES);
  const hosts = [...new Set(pages.flatMap(([l, p]) => (p ? [] : [new URL(l).hostname])))].slice(0, MAX_HOSTS);
  return { text: stripped, links, bandcampPages, hosts, found };
}

// Listening-queue brief C: an unsubscribe or preferences link (it can carry Tarik's address and a signature) is never kept.
// "unsub" only as a word, so a page like /album/unsubtle-days stays.
const UNWANTED_LINK = /unsubscribe|\bunsub\b|opt-?out|preferences|email_settings|settings\/notifications|\/track\/click(?:[/?]|$)/i;
// A query that holds an address (or names one) is personal, whatever the link is.
const ADDRESS_QUERY = /(?:^\?|&)email=|@|%40/i;
const CLICK_TRACKER = /(?:^|\.)list-manage\.com$/i; // Mailchimp's redirect host: the real link is hidden behind it
const TRACKING_PARAM = (k: string) => {
  const key = k.toLowerCase();
  return key.startsWith("utm_") || key === "from" || key === "ref";
};

/**
 * The links worth keeping for Tarik, in order: tracking (utm_*, from, ref, any case) and the fragment stripped (the same
 * rule as bandcampPageUrl); unsubscribe, preference and notification-settings links, a query holding an address,
 * click-tracking redirects and a bare site root (path "/" and no query) dropped; then duplicates removed. A value that is not a URL is left as is so the caller's own check still refuses it.
 */
export function tidyLinks(links: string[]): string[] {
  const out = links.flatMap((link) => {
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      return [link];
    }
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM(k)) u.searchParams.delete(k);
    u.hash = "";
    if (UNWANTED_LINK.test(u.pathname + u.search) || ADDRESS_QUERY.test(u.search) || CLICK_TRACKER.test(u.hostname) || (u.pathname === "/" && !u.search)) return [];
    return [u.href];
  });
  return [...new Set(out)];
}

/** At most `max` characters, cut at the last whitespace so a link is never cut in half (and then collected). */
function cutOnSpace(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"), cut.lastIndexOf("\t"));
  return space > 0 ? cut.slice(0, space) : cut;
}

// An email's own "[image 2]" or "[link 1]" is flattened, so every numbered marker in stored text is the cleaner's.
const flatten = (text: string) => text.replace(/\[(link|image)\s{0,3}\d{1,6}\]/gi, "[$1]");

/** A link as it is stored (http(s), tracking stripped), so a placeholder finds its number in the final list. */
const storedForm = (raw: string): string | undefined => {
  const l = httpLink(raw);
  return l ? tidyLinks([l])[0] : undefined;
};

/** Placeholders to markers: [link N] / [image N] where the address is in the final list; else [link] for a URL, nothing for a tag. */
function numbered(text: string, found: string[], links: string[], html: ReturnType<typeof markedHtml> | null, images: string[]): string {
  const linkNo = (raw: string | undefined) => {
    const n = raw === undefined ? 0 : links.indexOf(storedForm(raw) ?? "") + 1;
    return n ? `[link ${n}]` : null;
  };
  return text
    .replace(PLACEHOLDER, (_, kind: string, i: string) => {
      if (kind === "u") return linkNo(found[Number(i)]) ?? "[link]";
      if (kind === "a") return linkNo(html?.anchors[Number(i)]) ?? "";
      const n = images.indexOf(html?.imageAt[Number(i)] ?? "") + 1;
      return n ? `[image ${n}]` : "";
    })
    .replace(PLACEHOLDER_CHARS, "");
}

/**
 * The console's one call: unwrap the forward, strip links and addresses from body and subject, cap the body. Links are
 * numbered [link N] (links[N-1]). Decision 027: a co-sign email whose HTML holds an allowed cover is read from the HTML,
 * so each cover gets an [image N] (images[N-1]) where it was; any other email keeps its plain-text body.
 */
export function cleanMail(mail: InboundMail, decision: Extract<SenderDecision, { ok: true }>): CleanMail {
  const forward = unwrapForward(mail.text);
  const html = decision.tab === "cosign" && mail.html ? markedHtml(mail.html) : null;
  const fromHtml = html?.images.length ? html : null;
  const source = fromHtml ? unwrapForward(fromHtml.text).body : forward.body.replace(PLACEHOLDER_CHARS, "");
  const subject = strip(flatten(mail.subject.slice(0, MAX_SUBJECT_CHARS).replace(PLACEHOLDER_CHARS, "")), [], true);
  const body = strip(cutOnSpace(flatten(source), MAX_STORED_CHARS + BODY_MARGIN), [...mail.hrefs, ...subject.links], true);
  const from = forward.sender ?? parseFrom(mail.from);
  const sender = {
    ...(from.name ? { name: stripLinks(from.name.slice(0, MAX_NAME_CHARS)).text.slice(0, MAX_NAME_CHARS) } : {}),
    ...(from.address ? { address: from.address } : {}),
  };
  const links = tidyLinks(body.links);
  const images = fromHtml?.images ?? [];
  let text = numbered(body.text, body.found, links, fromHtml, images);
  // Placeholders came with spaces around them; one dropped (an unkept tag) or repeated (a linked URL) is tidied.
  if (fromHtml) text = text.replace(/(\[link \d+\])(?: \1)+/g, "$1").replace(/ {2,}/g, " ").replace(/ *\n */g, "\n");
  return {
    tab: decision.tab,
    ...(sender.name || sender.address ? { sender } : {}),
    subject: numbered(subject.text, subject.found, links, null, []),
    body: text.slice(0, MAX_STORED_CHARS),
    links,
    ...(images.length ? { images } : {}),
    bandcampPages: body.bandcampPages,
    hosts: body.hosts,
  };
}

/**
 * Decision 027: one release's own cover and links from the marker numbers the reader gave, looked up in the stored
 * email's lists. A number out of range, or a cover off the allowlist, gives nothing; no links at all leaves `links` out.
 */
export function markedMedia(f: { image?: number; links?: number[] }, images: string[], links: string[]): { art?: string; links?: string[] } {
  const at = (list: string[], n: number) => (Number.isInteger(n) && n >= 1 ? list[n - 1] : undefined);
  const cover = f.image === undefined ? undefined : at(images, f.image);
  const art = cover !== undefined && coverArtUrl(cover) === cover ? cover : undefined;
  const own = tidyLinks((f.links ?? []).flatMap((n) => at(links, n) ?? []));
  return { ...(art ? { art } : {}), ...(own.length ? { links: own } : {}) };
}
