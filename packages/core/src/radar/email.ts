import { BANDCAMP_DOMAIN, bandcampPageUrl } from "./bandcamp";

/** As much of an AgentMail message as the radar reads. Attachments are counted, never read. */
export interface InboundMail {
  messageId: string;
  from: string;
  subject: string;
  text: string;
  hrefs: string[];
  headers: Record<string, string>;
  attachmentCount: number;
  bodyMissing: boolean;
}

export type RadarTab = "bandcamp" | "cosign";
export type SenderDecision = { ok: true; tab: RadarTab; address: string } | { ok: false; reason: string };
export interface CleanMail {
  tab: RadarTab;
  sender?: { name?: string; address?: string };
  subject: string;
  body: string;
  links: string[];
  bandcampPages: string[];
  hosts: string[];
}

export const MAX_STORED_CHARS = 20_000;
/** A subject is cut to this before it is cleaned (radar.received keeps 200). */
export const MAX_SUBJECT_CHARS = 1_000;
const MAX_NAME_CHARS = 200; // radar.received's field limit
const BODY_MARGIN = 1_000; // the body is cut to its stored limit plus this before cleaning, then to the limit after
const MAX_FROM_CHARS = 998; // RFC 5322's line limit
const MAX_AUTH_RESULTS_CHARS = 4_096; // real Authentication-Results headers are well under 1 KB
const MAX_LINKS = 20;
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
    headers: pickHeaders(m.headers),
    attachmentCount: Array.isArray(m.attachments) ? m.attachments.length : 0,
    bodyMissing: text === undefined && html === undefined, // AgentMail omits both over 1 MB
  };
}

function pickHeaders(h: unknown): Record<string, string> {
  if (!h || typeof h !== "object" || Array.isArray(h)) return {};
  return Object.fromEntries(
    Object.entries(h).flatMap(([k, v]): [string, string][] =>
      // The topmost occurrence only (receivers prepend), never a join: a sender can add headers below it.
      typeof v === "string" ? [[k, v]] : Array.isArray(v) && typeof v[0] === "string" ? [[k, v[0]]] : [],
    ),
  );
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? whole;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
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
  // [^<>] rather than [^>]: an unclosed "<" then scans only to the next tag, so a run of them stays linear.
  const visible = dropBlocks(html).replace(/<(?:link|base)\b[^<>]*>/gi, " ");
  const hrefs = [...visible.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((m) => decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim()))
    .filter(Boolean);
  const text = decodeEntities(
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
  return { text, hrefs };
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

/**
 * Whether the topmost Authentication-Results, written by our own receiver (its authserv-id), holds a dkim=pass whose
 * header.d (or header.i) aligns with the From domain. Lower headers, or one from any other authserv-id, are the
 * sender's and are never trusted.
 */
function dkimAligned(headers: Record<string, string>, domain: string, authservId: string): boolean {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === "authentication-results");
  // A string holding several unfolded header lines: only the first is the topmost header.
  const value = (key ? headers[key]! : "").split(/\r?\n(?=\S)/)[0]!.slice(0, MAX_AUTH_RESULTS_CHARS);
  const [server, ...clauses] = value.split(";");
  if (server?.trim().split(/\s+/)[0]?.toLowerCase() !== authservId.toLowerCase()) return false;
  return clauses.some((raw) => {
    const clause = raw.replace(/\([^)]*\)/g, " "); // comments (e.g. ARC's inner "dkim=pass") are not verdicts
    if (!/(?:^|\s)dkim\s*=\s*pass\b/i.test(clause)) return false;
    const d = clause.match(/\bheader\.d\s*=\s*([^\s;]+)/i)?.[1] ?? clause.match(/\bheader\.i\s*=\s*([^\s;]+)/i)?.[1]?.replace(/^.*@/, "");
    return d !== undefined && aligned(d.toLowerCase(), domain);
  });
}

/** Relaxed DMARC-style alignment: equal, or one a dot-suffix subdomain of the other (email.bandcamp.com ↔ bandcamp.com). */
function aligned(signer: string, from: string): boolean {
  if (signer === from) return true;
  const [short, long] = signer.length < from.length ? [signer, from] : [from, signer];
  // ponytail: a bare TLD never aligns; public suffixes like co.uk are not special-cased (no allowlisted sender uses one).
  return short.includes(".") && long.endsWith(`.${short}`);
}

/**
 * Exact address on the allowlist, and a DKIM pass aligned (relaxed) with the From domain (a From line alone can be faked).
 * The tab is Bandcamp when the mail is from bandcamp.com, or when Tarik forwarded a bandcamp.com email by hand.
 */
export function senderDecision(
  mail: Pick<InboundMail, "from" | "headers" | "text">,
  allowlist: string[],
  authservId: string | undefined, // RADAR_AUTHSERV_ID: the receiver's id at the start of its Authentication-Results
): SenderDecision {
  const receiver = authservId?.trim();
  if (!receiver) return { ok: false, reason: "Air Check's sender check is not set up" };
  const address = parseFrom(mail.from).address;
  if (!address || !allowlist.includes(address)) return { ok: false, reason: "Sender not on the list" };
  const domain = address.slice(address.lastIndexOf("@") + 1);
  if (!dkimAligned(mail.headers, domain, receiver)) return { ok: false, reason: "Sender's signature (DKIM) did not pass" };
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
  const found: string[] = [];
  const toLink = (match: string) => {
    const core = match.replace(TRAILING, "");
    found.push(core);
    return "[link]" + match.slice(core.length);
  };
  const asLink = (m: string) => "[link]" + m.slice(m.replace(TRAILING, "").length);
  // NFKC first, so fullwidth and small-form look-alikes (ｈttps, ：, ＠, ﹫) become the ASCII the patterns catch.
  const linked = text
    .normalize("NFKC")
    .replace(MAILTO, "[email]")
    .replace(URL_IN_TEXT, toLink)
    .replace(TOKEN, (t) => (t.includes("://") || t.includes("[.]") ? asLink(t) : t))
    .replace(WWW_IN_TEXT, asLink);
  const stripped = replaceEmails(linked).replace(HOST_PATH, asLink).replace(/@/g, "(at)");
  // A link whose host radar.received would refuse (localhost, [::1], foo_bar, a trailing dot) is dropped, not kept for Tarik.
  const links = [...new Set([...found, ...hrefs].map(httpLink).filter((l): l is string => l !== null))]
    .filter((l) => l.length <= MAX_LINK_CHARS && isHostName(new URL(l).hostname))
    .slice(0, MAX_LINKS);
  const pages = links.map((l) => [l, bandcampPageUrl(l)] as const);
  const bandcampPages = [...new Set(pages.flatMap(([, p]) => (p ? [p] : [])))].slice(0, MAX_PAGES);
  const hosts = [...new Set(pages.flatMap(([l, p]) => (p ? [] : [new URL(l).hostname])))].slice(0, MAX_HOSTS);
  return { text: stripped, links, bandcampPages, hosts };
}

/** At most `max` characters, cut at the last whitespace so a link is never cut in half (and then collected). */
function cutOnSpace(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"), cut.lastIndexOf("\t"));
  return space > 0 ? cut.slice(0, space) : cut;
}

/** The console's one call: unwrap the forward, strip links and addresses from body and subject, cap the body. */
export function cleanMail(mail: InboundMail, decision: Extract<SenderDecision, { ok: true }>): CleanMail {
  const forward = unwrapForward(mail.text);
  const subject = stripLinks(mail.subject.slice(0, MAX_SUBJECT_CHARS));
  const body = stripLinks(cutOnSpace(forward.body, MAX_STORED_CHARS + BODY_MARGIN), [...mail.hrefs, ...subject.links]);
  const from = forward.sender ?? parseFrom(mail.from);
  const sender = {
    ...(from.name ? { name: stripLinks(from.name.slice(0, MAX_NAME_CHARS)).text.slice(0, MAX_NAME_CHARS) } : {}),
    ...(from.address ? { address: from.address } : {}),
  };
  return {
    tab: decision.tab,
    ...(sender.name || sender.address ? { sender } : {}),
    subject: subject.text,
    body: body.text.slice(0, MAX_STORED_CHARS),
    links: body.links,
    bandcampPages: body.bandcampPages,
    hosts: body.hosts,
  };
}
