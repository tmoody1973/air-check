import {
  type ActiveEmbargo,
  bandcampPageUrl,
  embedFromPaste,
  chicagoDayKey,
  coverArtUrl,
  agentEmbargoLines,
  bandcampArtUrl,
  bandcampPageForTitle,
  bandcampTag,
  describeEmbargo,
  embargoHits,
  embargoMatches,
  foldText,
  isEmbargoActive,
  isHostName,
  isShowDate,
  MAX_ABOUT_CHARS,
  MAX_IMAGES,
  markedMedia,
  MAX_RELEASES,
  MAX_STORED_CHARS,
  MAX_TAGS,
  type ReleaseFields,
  releaseKey,
  tidyLinks,
} from "@aircheck/core";
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { sameToken } from "./agentSubmit";
import { requireRealHuman } from "./episodes";
import { actorOf, type Workspace, workspaceOf } from "./gate";
import { requireIngest } from "./agentSubmit";
import { embargoV, radarTabV, releaseStatusV, releaseTypeV, workspaceV } from "./schema";

// Plan 8: the release radar. Forwarded email is untrusted data (Hard Rule 5). The one write an email may cause is its
// own inbox row, its releases records (one, or up to 12 for a roundup, decision 024; new or merged) with their queued player fetches, and the "links not followed"
// activity row. Nothing here reaches a package, a run or Mixcloud (Hard Rule 1), and nothing here fetches anything.
// - The console's inbound route has one mutation, `received` (INBOX_TOKEN); the catch-up script also has `reparse`.
// - The ingest worker has four: `pending`, `record`, `embedsWanted`, `embedResult` (INGEST_TOKEN).
// - A signed-in human moves records; the demo actor only on demo rows (Hard Rule 9).
// - The agent reads `agentList` through POST /agent/radar: no links, player, senders, email text or page about, and no
//   active embargo.

const MAX_SUBJECT = 200;
const MAX_ID = 500;
const MAX_ADDRESS = 320;
const MAX_SENDER_ADDRESS = 254; // core's parseFrom limit
const MAX_FIELD = 200;
const MAX_LINKS = 20;
const MAX_LINK = 500;
const MAX_PAGES = 3;
const MAX_HOSTS = 20;
const MAX_REASONS = 10;
const MAX_REASON = 300;
const MAX_SENDERS = 10;
const MAX_IGNORED = 200;
const MAX_LIST = 500;
const MAX_AGENT = 100;
const MAX_NOT_ADDED = 50;
const MAX_SEARCH = 200;
const WAITING_MS = 10 * 60_000;
const PENDING_BATCH = 5;
const EMBED_BATCH = 3;
const EMBED_ID = /^\d{1,12}$/;
const FAIL_CODE = /^[a-z_0-9]{1,40}$/;
/** A redirect off Bandcamp or a page that failed the URL rule was never read: blocked. Any other code was a fetch made. */
const NOT_READ = new Set(["redirect_off_host", "not_allowed"]);
/** Stored email text holds no link or address: the console replaced them (core's stripLinks). */
const LINK_OR_ADDRESS = /:\/\/|@/;
/** Release fields reach the agent, so they hold no link, address or www. host either. */
const LINKISH = /:\/\/|@|\bwww\./i;
const HTTP_LINK = /^https?:\/\//;
const FILLABLE = ["label", "type", "releasedOn", "genre"] as const;

const badInput = (message: string) => new ConvexError({ code: "BAD_INPUT", message });
const FORBIDDEN = new ConvexError({ code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can do this" });

/**
 * The console's INBOX_TOKEN, in constant time. Fails closed when unset or under 32 characters, and refuses everything
 * when it equals any other service's token, so one service can never act as another (Hard Rule 2).
 */
function requireInbox(token: string): void {
  const { INBOX_TOKEN, INGEST_TOKEN, MEDIA_TOKEN, PUBLISHER_TOKEN, RELAY_TOKEN, AGENT_SUBMIT_TOKEN, DEMO_AGENT_SUBMIT_TOKEN } = process.env;
  const shared = [INGEST_TOKEN, MEDIA_TOKEN, PUBLISHER_TOKEN, RELAY_TOKEN, AGENT_SUBMIT_TOKEN, DEMO_AGENT_SUBMIT_TOKEN].includes(INBOX_TOKEN);
  if (shared || !sameToken(token, INBOX_TOKEN)) throw new ConvexError({ code: "UNAUTHORIZED" });
}

/** Rows written before Plan 8 have no status: they read as new. */
export const statusOf = (r: Doc<"releases">): Infer<typeof releaseStatusV> => r.status ?? "new";
/** Rows written before Plan 8 have no source: the old Today card called them Bandcamp releases. */
const tabOf = (r: Doc<"releases">): Infer<typeof radarTabV> => r.source ?? "bandcamp";

type SearchFields = Pick<Doc<"releases">, "artist" | "title" | "label" | "tags" | "about">;
/** Task 6b: artist, title, label, tags and about, folded, for the search index. Rewritten on every write that changes them. */
export const searchTextOf = (r: SearchFields): string => foldText([r.artist, r.title, r.label, ...(r.tags ?? []), r.about].filter(Boolean).join(" "));

/**
 * Task 6b: what the ingest worker read from the Bandcamp page besides the player id. Each value passes core's check
 * again, or is dropped (never thrown: a throw would leave the page queued and fetched again every pass).
 */
function pageDetails(r: { art?: string; tags?: string[]; about?: string }): Pick<Doc<"releases">, "art" | "tags" | "about"> {
  const art = r.art !== undefined && bandcampArtUrl(r.art) === r.art ? r.art : undefined;
  const tags = [...new Set((r.tags ?? []).filter((t) => bandcampTag(t) === t))].slice(0, MAX_TAGS);
  const about = r.about?.trim() && r.about.length <= MAX_ABOUT_CHARS && !LINKISH.test(r.about) ? r.about : undefined;
  return { art, tags: tags.length ? tags : undefined, about };
}

const senderV = v.object({ name: v.optional(v.string()), address: v.optional(v.string()) });
/** Core's CleanMail, exactly. */
const cleanMailV = v.object({
  tab: radarTabV,
  sender: v.optional(senderV),
  subject: v.string(),
  body: v.string(),
  links: v.array(v.string()),
  images: v.optional(v.array(v.string())),
  bandcampPages: v.array(v.string()),
  hosts: v.array(v.string()),
});
/** Core's ReleaseFields, exactly. A forged outcome with any other key (status, approve, sendTo...) fails validation. */
const releaseFieldsV = v.object({
  artist: v.string(),
  title: v.string(),
  label: v.optional(v.string()),
  type: v.optional(releaseTypeV),
  releasedOn: v.optional(v.string()),
  genre: v.optional(v.string()),
  embargo: v.optional(embargoV),
  // Decision 027: marker numbers into the stored email's images and links, never addresses.
  image: v.optional(v.number()),
  links: v.optional(v.array(v.number())),
});
const outcomeV = v.union(
  // Decision 024: a roundup's other releases ride in `more`; a one-release email has no `more`.
  v.object({ kind: v.literal("saved"), release: releaseFieldsV, more: v.optional(v.array(releaseFieldsV)) }),
  v.object({ kind: v.union(v.literal("not-a-release"), v.literal("refused"), v.literal("failed")), reasons: v.array(v.string()) }),
);
type CleanMailArg = Infer<typeof cleanMailV>;
type Embargo = Infer<typeof embargoV>;

const tooLong = (s: string | undefined, max: number) => (s?.length ?? 0) > max;
/** An embargo's date is null (undated, still active) or a real date. "" would read as no embargo: refused. */
const embargoDateOk = (e: Embargo | null | undefined) => !e || e.until === null || isShowDate(e.until);

const linkHostOk = (l: string) => {
  try {
    return isHostName(new URL(l).hostname);
  } catch {
    return false;
  }
};

/**
 * Hosts, links and a sender address that core already drops are dropped here too, never refused: a refusal is a 503,
 * and after Svix's retries the email is gone with no row anywhere (final review I1).
 */
function tidyMail(m: CleanMailArg): CleanMailArg {
  const { address, ...rest } = m.sender ?? {};
  const keep = address !== undefined && address.length <= MAX_SENDER_ADDRESS;
  const sender = { ...rest, ...(keep ? { address } : {}) };
  const { sender: _, images, ...mail } = m;
  // Decision 027: all or none, so an [image N] never points at a different cover than the one the console numbered.
  const coversOk = images !== undefined && images.length > 0 && images.length <= MAX_IMAGES && images.every((i) => coverArtUrl(i) === i);
  return {
    ...mail,
    ...(coversOk && { images }),
    ...(sender.name || sender.address ? { sender } : {}),
    // A non-http link stays, so mailProblem refuses it. Brief C: core's tidyLinks again, so a stored row never holds an
    // unsubscribe link, a bare site root or a tracking copy of a link it already has.
    links: tidyLinks(m.links.filter((l) => !HTTP_LINK.test(l) || linkHostOk(l))),
    hosts: m.hosts.filter(isHostName),
  };
}

function mailProblem(m: CleanMailArg): string | null {
  if (LINK_OR_ADDRESS.test(m.body) || LINK_OR_ADDRESS.test(m.subject)) return "the stored text must hold no link or address";
  if (m.body.length > MAX_STORED_CHARS) return `the body is over ${MAX_STORED_CHARS} characters`;
  if (tooLong(m.sender?.name, MAX_FIELD) || tooLong(m.sender?.address, MAX_ADDRESS) || LINK_OR_ADDRESS.test(m.sender?.name ?? "")) return "the sender is not a plain name and address";
  if (m.links.length > MAX_LINKS || m.links.some((l) => l.length > MAX_LINK)) return `at most ${MAX_LINKS} links of ${MAX_LINK} characters`;
  if (m.bandcampPages.length > MAX_PAGES || m.bandcampPages.some((l) => l.length > MAX_LINK)) return `at most ${MAX_PAGES} Bandcamp pages`;
  if ([...m.links, ...m.bandcampPages].some((l) => !HTTP_LINK.test(l))) return "stored links must be http or https";
  if (m.hosts.length > MAX_HOSTS) return `at most ${MAX_HOSTS} hosts`;
  return null;
}

function releaseProblem(f: ReleaseFields): string | null {
  for (const [k, val] of Object.entries(f)) {
    if (typeof val !== "string") continue;
    if (tooLong(val, MAX_FIELD)) return `The ${k} is over ${MAX_FIELD} characters`;
    if (LINKISH.test(val)) return `The ${k} must not hold a link or address`;
  }
  if (!f.artist.trim() || !f.title.trim()) return "Artist and title are required";
  if ((f.links?.length ?? 0) > MAX_LINKS) return `At most ${MAX_LINKS} links on one release`;
  if (f.releasedOn !== undefined && !isShowDate(f.releasedOn)) return "The release date must be a date, yyyy-mm-dd";
  if (!embargoDateOk(f.embargo)) return "The embargo date must be a date, yyyy-mm-dd";
  return null;
}

const inboxByMessageId = (ctx: QueryCtx, messageId: string) =>
  ctx.db.query("inbox").withIndex("by_messageId", (q) => q.eq("messageId", messageId)).first();

/**
 * The console's one call (Plan 8 Task 3's inbound route). Stores a cleaned email once per message id, except that an
 * ignored row gives way to a kept one (R12); `mail: null` is an ignored sender, stored with its reason and no body. Links the email held are kept for Tarik and never fetched; one
 * activity row says so, with host names only.
 */
export const received = mutation({
  args: {
    token: v.string(),
    messageId: v.string(),
    receivedAt: v.number(),
    from: v.string(),
    subject: v.string(),
    mail: v.union(cleanMailV, v.null()),
    ignoredReason: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ fresh: boolean }> => {
    requireInbox(a.token);
    if (!a.messageId || tooLong(a.messageId, MAX_ID) || tooLong(a.from, MAX_ADDRESS)) throw badInput("messageId and from must be short");
    if (LINK_OR_ADDRESS.test(a.subject)) throw badInput("the stored text must hold no link or address");
    if (!a.mail && !a.ignoredReason?.trim()) throw badInput("an ignored email needs a reason");
    if (tooLong(a.ignoredReason, MAX_REASON)) throw badInput(`the reason is over ${MAX_REASON} characters`);
    const tidy = a.mail && tidyMail(a.mail);
    const problem = tidy && mailProblem(tidy);
    if (problem) throw badInput(problem);
    const existing = await inboxByMessageId(ctx, a.messageId);
    // Ruling R12's catch-up: an email ignored before (the sender check could never pass) is stored again once it is kept.
    // A kept row is never replaced, and an ignored one is never re-ignored.
    if (existing && (existing.state !== "ignored" || !tidy)) return { fresh: false };
    if (existing) await ctx.db.delete(existing._id);

    const base = { messageId: a.messageId, receivedAt: a.receivedAt, from: a.from, subject: a.subject.slice(0, MAX_SUBJECT) };
    const m = tidy;
    if (!m) {
      await ctx.db.insert("inbox", { ...base, state: "ignored", reasons: [a.ignoredReason!.trim()], linkCount: 0 });
      await pruneIgnored(ctx);
      return { fresh: true };
    }
    await ctx.db.insert("inbox", {
      ...base,
      state: "received",
      tab: m.tab,
      ...(m.sender && { sender: m.sender }),
      body: m.body,
      links: m.links,
      ...(m.images && { images: m.images }),
      bandcampPages: m.bandcampPages,
      linkCount: m.links.length,
    });
    if (m.hosts.length) {
      const notFollowed = m.links.filter((l) => bandcampPageUrl(l) === null).length;
      await ctx.db.insert("activity", {
        workspace: "real",
        at: a.receivedAt,
        kind: "action",
        result: "blocked",
        title: `Links in an email were not followed (${notFollowed})`,
        destination: m.hosts.join(", "),
        reason: "Email is data: links are kept for you and never fetched",
      });
    }
    return { fresh: true };
  },
});

// ponytail: a simple cap on ignored rows; add a cron prune if the inbox gets busy.
async function pruneIgnored(ctx: MutationCtx) {
  const ignored = await ctx.db.query("inbox").withIndex("by_state_receivedAt", (q) => q.eq("state", "ignored")).order("desc").collect();
  for (const r of ignored.slice(MAX_IGNORED)) await ctx.db.delete(r._id);
}

/** The ingest worker's batch: received emails, oldest first. */
export const pending = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireIngest(token);
    const rows = await ctx.db.query("inbox").withIndex("by_state_receivedAt", (q) => q.eq("state", "received")).order("asc").take(PENDING_BATCH);
    return rows.map((r) => ({ messageId: r.messageId, tab: r.tab ?? ("cosign" as const), subject: r.subject, body: r.body ?? "", receivedAt: r.receivedAt }));
  },
});

/**
 * What the ingest worker read from one email. The sender, links and Bandcamp pages come from the stored inbox row, never
 * from these arguments. A row no longer `received` (a crash between pending and record, read twice) is left alone.
 */
export const record = mutation({
  args: { token: v.string(), messageId: v.string(), outcome: outcomeV },
  handler: async (ctx, { token, messageId, outcome }): Promise<{ releaseId?: Id<"releases">; merged?: boolean }> => {
    requireIngest(token);
    const row = await inboxByMessageId(ctx, messageId);
    if (!row) throw new ConvexError({ code: "NOT_FOUND", message: "no such email" });
    if (row.state !== "received") return {};
    if (outcome.kind !== "saved") {
      if (outcome.reasons.length > MAX_REASONS || outcome.reasons.some((r) => tooLong(r, MAX_REASON))) throw badInput(`at most ${MAX_REASONS} short reasons`);
      // A refused or failed email keeps its body so Try again can read it again.
      await ctx.db.patch(row._id, { state: outcome.kind, reasons: outcome.reasons, ...(outcome.kind === "not-a-release" && { body: undefined }) });
      return {};
    }
    // A release that breaks a rule is refused with the plain reason (body kept for Try again), never thrown: a throw
    // would leave the row at the head of pending for ever.
    // Decision 024: a roundup is all or nothing, so Try again reads the same email whole.
    const all = [outcome.release, ...(outcome.more ?? [])];
    const problem = all.length > MAX_RELEASES ? `At most ${MAX_RELEASES} releases in one email` : all.map(releaseProblem).find((p) => p !== null);
    if (problem) {
      await ctx.db.patch(row._id, { state: "refused", reasons: [problem] });
      return {};
    }
    // The stored pages pass the URL rule again here: a page forged past the console queues nothing. One release takes
    // the email's first page; in a roundup each release takes only the page whose slug is its own title.
    const pages = row.bandcampPages ?? [];
    const pageFor = (f: ReleaseFields) => (all.length === 1 ? (pages.map(bandcampPageUrl).find((p): p is string => p !== null) ?? null) : bandcampPageForTitle(pages, f.title));
    const keys = new Set<string>();
    const saves = [];
    for (const f of all) {
      const key = releaseKey(f.artist, f.title);
      if (keys.has(key)) continue;
      keys.add(key);
      saves.push(await saveRelease(ctx, row, f, pageFor(f)));
    }
    const { releaseId } = saves[0]!;
    const merged = saves.every((x) => x.merged);
    await ctx.db.patch(row._id, { state: merged ? "merged" : "saved", releaseId, body: undefined, reasons: undefined });
    return { releaseId, merged };
  },
});

/** The stricter of two embargoes: an undated one beats a date, a later date beats an earlier one. */
function stricter(a: Embargo | undefined, b: Embargo | undefined): Embargo | undefined {
  if (!a || !b) return a ?? b;
  if (a.until === null || b.until === null) return { until: null };
  return { until: a.until > b.until ? a.until : b.until };
}

/**
 * One record per release key. A merge fills only empty fields Tarik has not edited and leaves status and tab alone.
 * Decision 027: the reader's image and link numbers become this release's own cover and links from the stored email;
 * with no link numbers the release takes every link the email held, as before.
 */
async function saveRelease(ctx: MutationCtx, row: Doc<"inbox">, marked: ReleaseFields, page: string | null): Promise<{ releaseId: Id<"releases">; merged: boolean }> {
  const { image, links: linkNumbers, ...f } = marked;
  const media = markedMedia({ image, links: linkNumbers }, row.images ?? [], row.links ?? []);
  const links = media.links ?? row.links ?? [];
  const key = releaseKey(f.artist, f.title);
  const sender = { ...row.sender, messageId: row.messageId, at: row.receivedAt };
  const queue = page ? { bandcampPage: page, embedState: "queued" as const, embedQueuedAt: Date.now() } : {};
  const cur = await ctx.db.query("releases").withIndex("by_workspace_key", (q) => q.eq("workspace", "real").eq("key", key)).first();
  if (!cur) {
    const fields = Object.fromEntries(Object.entries(f).filter(([, val]) => val !== undefined)) as typeof f;
    const releaseId = await ctx.db.insert("releases", {
      workspace: "real",
      ...fields,
      searchText: searchTextOf(fields),
      status: "new",
      source: row.tab ?? "cosign",
      senders: [sender],
      links,
      ...(media.art && { art: media.art }),
      key,
      receivedAt: row.receivedAt,
      ...queue,
    });
    return { releaseId, merged: false };
  }
  const edited = new Set(cur.editedFields ?? []);
  const fill = Object.fromEntries(FILLABLE.filter((k) => f[k] !== undefined && cur[k] === undefined && !edited.has(k)).map((k) => [k, f[k]]));
  // R5: Tarik's own embargo (cleared or dated by hand) always wins; a later email only leaves a notice for him.
  const tarikSet = edited.has("embargo");
  const embargo = tarikSet ? undefined : stricter(cur.embargo, f.embargo);
  await ctx.db.patch(cur._id, {
    ...fill,
    searchText: searchTextOf({ ...cur, ...fill }),
    ...(embargo && { embargo }),
    ...(tarikSet && f.embargo && { laterEmbargoNotice: { at: row.receivedAt, until: f.embargo.until } }),
    senders: [...(cur.senders ?? []), sender].slice(0, MAX_SENDERS),
    links: [...new Set([...(cur.links ?? []), ...links])].slice(0, MAX_LINKS),
    ...(!cur.art && media.art && { art: media.art }),
    ...(!cur.bandcampPage && queue),
  });
  return { releaseId: cur._id, merged: true };
}

/** Real releases waiting for their Bandcamp player id, oldest first. Each page passes the URL rule again. */
export const embedsWanted = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    requireIngest(token);
    // ponytail: collects the whole queue to filter it; it holds a handful of rows. Index by workspace if it ever grows.
    const queued = await ctx.db.query("releases").withIndex("by_embedState", (q) => q.eq("embedState", "queued")).collect();
    return queued
      .filter((r) => r.workspace === "real" && r.bandcampPage !== undefined && bandcampPageUrl(r.bandcampPage) === r.bandcampPage)
      .slice(0, EMBED_BATCH)
      .map((r) => ({ releaseId: r._id, pageUrl: r.bandcampPage! }));
  },
});

/** The player id the ingest worker read from the page (or a short failure code), and one audit row with the host only. */
export const embedResult = mutation({
  args: {
    token: v.string(),
    releaseId: v.id("releases"),
    pageUrl: v.string(),
    result: v.union(
      v.object({
        kind: v.union(v.literal("album"), v.literal("track")),
        id: v.string(),
        art: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        about: v.optional(v.string()),
        releasedOn: v.optional(v.string()),
        pageArtist: v.optional(v.string()),
      }),
      v.object({ failed: v.string() }),
    ),
  },
  handler: async (ctx, { token, releaseId, pageUrl, result }) => {
    requireIngest(token);
    const rel = await ctx.db.get(releaseId);
    if (!rel || rel.workspace !== "real" || !rel.bandcampPage || rel.bandcampPage !== pageUrl) throw badInput("pageUrl is not this release's Bandcamp page");
    if ("failed" in result ? !FAIL_CODE.test(result.failed) : !EMBED_ID.test(result.id)) throw badInput("the result must be a player id (digits) or a short failure code");
    if (rel.embedState !== "queued") return null;
    const destination = new URL(pageUrl).hostname;
    const row = { workspace: "real" as const, at: Date.now(), kind: "network" as const, destination };
    if ("failed" in result) {
      // B2: a page re-read for its date (radar.reparse) that fails keeps the player that already worked.
      await ctx.db.patch(releaseId, rel.embed ? { embedState: "ready", embedError: undefined } : { embedState: "failed", embedError: result.failed, embed: undefined });
      const blocked = NOT_READ.has(result.failed);
      await ctx.db.insert("activity", { ...row, title: blocked ? "Bandcamp page not read" : "Read a Bandcamp page for its player", result: blocked ? "blocked" : "allowed", reason: result.failed });
    } else {
      // A re-read (radar.reparse, B2: the release already has a player) only adds what the page gave; a detail it did not
      // find this time is kept, never erased.
      const read = pageDetails(result);
      // Decision 027: the page's cover replaces an email's; a page with none keeps it.
      const details = rel.embed ? Object.fromEntries(Object.entries(read).filter(([, val]) => val !== undefined)) : { ...read, art: read.art ?? rel.art };
      // The page's release date fills an empty one only, never one Tarik set or cleared (as a merge fill). A bad date is
      // dropped, not thrown. Not part of searchText.
      const fillDate = result.releasedOn !== undefined && isShowDate(result.releasedOn) && rel.releasedOn === undefined && !(rel.editedFields ?? []).includes("releasedOn");
      const artist = await pageArtistFill(ctx, rel, result.pageArtist);
      await ctx.db.patch(releaseId, {
        embedState: "ready",
        embed: { kind: result.kind, id: result.id },
        embedError: undefined,
        ...details,
        ...(fillDate && { releasedOn: result.releasedOn }),
        ...artist,
        searchText: searchTextOf({ ...rel, ...details, ...artist }),
      });
      await ctx.db.insert("activity", { ...row, title: "Read a Bandcamp page for its player", result: "allowed" });
    }
    return null;
  },
});

/** True when no other real release holds this key (a key change must never make two records one). */
async function keyFree(ctx: QueryCtx, key: string, self: Id<"releases">): Promise<boolean> {
  const other = await ctx.db.query("releases").withIndex("by_workspace_key", (q) => q.eq("workspace", "real").eq("key", key)).first();
  return !other || other._id === self;
}

/**
 * Listening-queue brief A: the page's JSON-LD artist fills an EMPTY artist only (never one already set, never one Tarik
 * edited), with its key, and only when that key is free. Anything else is dropped, never thrown.
 */
async function pageArtistFill(ctx: MutationCtx, rel: Doc<"releases">, name: string | undefined): Promise<{ artist: string; key: string } | Record<string, never>> {
  const artist = name?.trim();
  if (!artist || rel.artist.trim() || (rel.editedFields ?? []).includes("artist") || tooLong(artist, MAX_FIELD) || LINKISH.test(artist)) return {};
  const key = releaseKey(artist, rel.title);
  return (await keyFree(ctx, key, rel._id)) ? { artist, key } : {};
}

const reparseFieldsV = v.object({ artist: v.string(), title: v.string(), label: v.optional(v.string()) });
type ReparseResult = { result: "repaired" | "unchanged" | "collision" | "not-found"; requeued: boolean };

/**
 * Listening-queue brief B: the one-off repair of releases the old Bandcamp parser stored wrong (INBOX_TOKEN, the
 * catch-up script; never a human or the agent). The fields are the fixed parser's reading of the same kept email. It finds
 * the real release that email made, patches artist, title and label where Tarik has not edited them, and recomputes key
 * and searchText; if the new key is another release's, both are left alone. B2: a ready Bandcamp-tab page with no
 * release date is queued again so the date reader runs (embedResult keeps the old player if that read fails).
 * `dryRun` answers the same and writes nothing.
 */
export const reparse = mutation({
  args: { token: v.string(), messageId: v.string(), fields: reparseFieldsV, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { token, messageId, fields, dryRun }): Promise<ReparseResult> => {
    requireInbox(token);
    const f = { artist: fields.artist.trim(), title: fields.title.trim(), label: fields.label?.trim() || undefined };
    const problem = releaseProblem(f);
    if (problem) throw badInput(problem);
    // ponytail: scans the real releases (hundreds at radio scale) for the sender's message id; a one-off repair.
    const rel = (await ctx.db.query("releases").withIndex("by_workspace", (q) => q.eq("workspace", "real")).collect()).find((r) =>
      (r.senders ?? []).some((s) => s.messageId === messageId),
    );
    if (!rel) return { result: "not-found", requeued: false };

    const edited = new Set(rel.editedFields ?? []);
    const next = { artist: edited.has("artist") ? rel.artist : f.artist, title: edited.has("title") ? rel.title : f.title };
    // No label in the parse clears only the old parser's mistake (the sender stored as the label); any other label stays.
    const label = edited.has("label") ? rel.label : (f.label ?? (rel.label === next.artist ? undefined : rel.label));
    const key = releaseKey(next.artist, next.title);
    const changed = next.artist !== rel.artist || next.title !== rel.title || label !== rel.label || key !== rel.key;
    if (changed && !(await keyFree(ctx, key, rel._id))) return { result: "collision", requeued: false };

    // Never for a date Tarik set or cleared: embedResult would not fill it anyway.
    const requeue = tabOf(rel) === "bandcamp" && rel.bandcampPage !== undefined && rel.releasedOn === undefined && rel.embedState === "ready" && !edited.has("releasedOn");
    if (!dryRun) {
      const fix = { ...next, label, key };
      await ctx.db.patch(rel._id, {
        ...(changed && { ...fix, searchText: searchTextOf({ ...rel, ...fix }) }),
        ...(requeue && { embedState: "queued" as const, embedQueuedAt: Date.now() }),
      });
    }
    return { result: changed ? "repaired" : "unchanged", requeued: requeue };
  },
});

/** A release the caller may change: a real human on a real row, the demo actor on a demo row (Hard Rule 9). */
async function ownRelease(ctx: MutationCtx, releaseId: Id<"releases">): Promise<Doc<"releases">> {
  const ws = workspaceOf(await actorOf(ctx));
  const doc = ws ? await ctx.db.get(releaseId) : null;
  if (!ws || !doc || doc.workspace !== ws) throw FORBIDDEN;
  return doc;
}

export const setStatus = mutation({
  args: { releaseId: v.id("releases"), status: releaseStatusV, reason: v.optional(v.string()) },
  handler: async (ctx, { releaseId, status, reason }) => {
    await ownRelease(ctx, releaseId);
    if (tooLong(reason, MAX_FIELD)) throw badInput(`the reason is over ${MAX_FIELD} characters`);
    await ctx.db.patch(releaseId, { status, statusAt: Date.now(), passReason: status === "passed" ? reason?.trim() || undefined : undefined });
  },
});

/** Tarik's edit. An empty string clears a field. Edited fields are never overwritten by a later email. */
export const edit = mutation({
  args: {
    releaseId: v.id("releases"),
    fields: v.object({ label: v.optional(v.string()), genre: v.optional(v.string()), type: v.optional(v.union(releaseTypeV, v.literal(""))), releasedOn: v.optional(v.string()) }),
  },
  handler: async (ctx, { releaseId, fields }) => {
    const doc = await ownRelease(ctx, releaseId);
    const keys = Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined);
    if (!keys.length) throw badInput("nothing to change");
    const val = (s: string | undefined) => s?.trim() || undefined;
    for (const s of [fields.label, fields.genre]) {
      if (tooLong(s, MAX_FIELD)) throw badInput(`labels and genres are at most ${MAX_FIELD} characters`);
      if (LINKISH.test(s ?? "")) throw badInput("a label or genre must not hold a link or address");
    }
    const releasedOn = val(fields.releasedOn);
    if (releasedOn && !isShowDate(releasedOn)) throw badInput("the release date must be a date, yyyy-mm-dd");
    const patch = { label: val(fields.label), genre: val(fields.genre), type: fields.type || undefined, releasedOn };
    const changes = Object.fromEntries(keys.map((k) => [k, patch[k as keyof typeof patch]]));
    await ctx.db.patch(releaseId, {
      ...changes,
      editedFields: [...new Set([...(doc.editedFields ?? []), ...keys])],
      searchText: searchTextOf({ ...doc, ...changes }),
    });
  },
});

/**
 * `embargo: null` is "Clear embargo". A dated or undated embargo is set as given. R5: either way the embargo is Tarik's
 * from now on (marked edited), so no later email re-embargoes it; his choice also settles any open notice.
 */
export const setEmbargo = mutation({
  args: { releaseId: v.id("releases"), embargo: v.union(v.null(), embargoV) },
  handler: async (ctx, { releaseId, embargo }) => {
    const doc = await ownRelease(ctx, releaseId);
    if (!embargoDateOk(embargo)) throw badInput("the embargo date must be a date, yyyy-mm-dd");
    await ctx.db.patch(releaseId, {
      embargo: embargo ?? undefined,
      laterEmbargoNotice: undefined,
      editedFields: [...new Set([...(doc.editedFields ?? []), "embargo"])],
    });
  },
});

/** Task 6b: Tarik's ☆. Independent of status: no status change sets or clears it. */
export const setFavorite = mutation({
  args: { releaseId: v.id("releases"), favorite: v.boolean() },
  handler: async (ctx, { releaseId, favorite }) => {
    await ownRelease(ctx, releaseId);
    await ctx.db.patch(releaseId, { favorite });
  },
});

/** "Try again" on an email that was refused or failed: it goes back to the ingest worker with its kept body. */
export const retry = mutation({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) => {
    await requireRealHuman(ctx);
    const row = await inboxByMessageId(ctx, messageId);
    if (!row || (row.state !== "refused" && row.state !== "failed")) throw badInput("only an email that was refused or failed can be read again");
    await ctx.db.patch(row._id, { state: "received", reasons: undefined });
  },
});

/**
 * Oct 30: Tarik pastes the player code from Bandcamp's Share → Embed, because Bandcamp answers the ingest worker's page
 * reads with a bot check. Read in code (core embedFromPaste); nothing is fetched. A late worker result is ignored
 * (embedResult acts only on a queued release).
 */
export const pastePlayer = mutation({
  // Oct 30: the bookmarklet also sends the page's cover and address; each is kept only if it passes the same URL rules.
  args: { releaseId: v.id("releases"), pasted: v.string(), art: v.optional(v.string()), page: v.optional(v.string()) },
  handler: async (ctx, { releaseId, pasted, art, page }) => {
    await requireRealHuman(ctx);
    const doc = await ownRelease(ctx, releaseId);
    if (pasted.length > 5_000) throw badInput("That is too long for Bandcamp's embed code.");
    const embed = embedFromPaste(pasted);
    if (!embed) throw badInput("That isn't Bandcamp's embed code. On the Bandcamp page: Share, then Embed, then copy the code.");
    const cover = art !== undefined && art.length <= 500 ? bandcampArtUrl(art) : null;
    const link = !doc.bandcampPage && page !== undefined && page.length <= 500 ? bandcampPageUrl(page) : null;
    await ctx.db.patch(releaseId, { embed, embedState: "ready", embedError: undefined, ...(cover && { art: cover }), ...(link && { bandcampPage: link }) });
  },
});

/** Oct 30: the bookmarklet's attach page. Real releases (both tabs) whose title words all match; [] for anyone else. */
export const attachCandidates = query({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return [];
    const words = foldText(title.slice(0, MAX_SEARCH)).split(" ").filter(Boolean).slice(0, 16);
    if (!words.length) return [];
    const found = await ctx.db
      .query("releases")
      .withSearchIndex("search_text", (q) => q.search("searchText", words.join(" ")).eq("workspace", "real"))
      .take(20);
    return found
      .filter((r) => matchesAll(words, r))
      .slice(0, 5)
      .map((r) => ({ _id: r._id, artist: r.artist, title: r.title, hasPlayer: !!r.embed }));
  },
});

/** "Try again" on a player the ingest worker could not read. */
export const retryEmbed = mutation({
  args: { releaseId: v.id("releases") },
  handler: async (ctx, { releaseId }) => {
    const doc = await ownRelease(ctx, releaseId);
    if (doc.embedState !== "failed") throw badInput("only a player that failed can be tried again");
    await ctx.db.patch(releaseId, { embedState: "queued", embedError: undefined, embedQueuedAt: Date.now() });
  },
});

/** The search box's words that are all in a row: each must start a word of its searchText (Convex search alone matches any). */
const matchesAll = (words: string[], r: Doc<"releases">) => {
  const have = (r.searchText ?? "").split(" ");
  return words.every((w) => have.some((h) => h.startsWith(w)));
};

/**
 * One tab of the Release radar page, newest first, with the counts for the status chips. Private view. Task 6b: a
 * search runs over artist, title, label, tags and about (the search index), in the caller's workspace and tab only.
 */
export const list = query({
  args: { tab: radarTabV, status: v.optional(releaseStatusV), search: v.optional(v.string()) },
  handler: async (ctx, { tab, status, search }) => {
    const ws = workspaceOf(await actorOf(ctx));
    if (!ws) return null;
    // Convex search takes at most 16 terms.
    const words = foldText((search ?? "").slice(0, MAX_SEARCH)).split(" ").filter(Boolean).slice(0, 16);
    const found = words.length
      ? (
          await ctx.db
            .query("releases")
            .withSearchIndex("search_text", (q) => q.search("searchText", words.join(" ")).eq("workspace", ws).eq("source", tab))
            .take(MAX_LIST)
        )
          .filter((r) => matchesAll(words, r))
          .sort((a, b) => (b.receivedAt ?? b._creationTime) - (a.receivedAt ?? a._creationTime))
      : await ctx.db
          .query("releases")
          .withIndex("by_workspace_source_receivedAt", (q) => q.eq("workspace", ws).eq("source", tab))
          .order("desc")
          .take(MAX_LIST);
    // Brief C: rows stored before the link rule show tidy links too.
    const rows = found.map(({ searchText: _searchText, ...r }) => ({ ...r, status: statusOf(r), ...(r.links && { links: tidyLinks(r.links) }) }));
    const counts = { new: 0, considering: 0, played: 0, passed: 0 };
    for (const r of rows) counts[r.status] += 1;
    return { rows: status ? rows.filter((r) => r.status === status) : rows, counts };
  },
});

/** Why an email made no record: the last emails not saved or merged, with plain reasons. Never the body. */
export const notAdded = query({
  args: {},
  handler: async (ctx) => {
    if (workspaceOf(await actorOf(ctx)) !== "real") return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("inbox")
      .withIndex("by_receivedAt")
      .order("desc")
      .filter((q) => q.and(q.neq(q.field("state"), "saved"), q.neq(q.field("state"), "merged")))
      .take(MAX_NOT_ADDED);
    return rows.map((r) => ({
      messageId: r.messageId,
      receivedAt: r.receivedAt,
      from: r.from,
      subject: r.subject,
      state: r.state,
      ...(r.tab && { tab: r.tab }),
      reasons: r.state === "received" ? (now - r.receivedAt > WAITING_MS ? ["Waiting to be read"] : []) : (r.reasons ?? []),
    }));
  },
});

// ponytail: scans the workspace's releases (hundreds at radio scale). Add an index on embargo if it grows.
const embargoedRows = async (ctx: QueryCtx, workspace: Workspace, today: string) =>
  (await ctx.db.query("releases").withIndex("by_workspace", (q) => q.eq("workspace", workspace)).collect()).filter((r) => isEmbargoActive(r.embargo, today));
const asActive = (r: Doc<"releases">): ActiveEmbargo => ({ artist: r.artist, title: r.title, until: r.embargo!.until });

/** Active embargoes in a workspace on `today` (a Chicago day key). Plan 8 Task 5 and Plan 7 check text against these. */
export async function activeEmbargoes(ctx: QueryCtx, workspace: Workspace, today: string): Promise<ActiveEmbargo[]> {
  return (await embargoedRows(ctx, workspace, today)).map(asActive);
}

type EmbargoInput = { description?: string; tracks?: { artist: string; title: string }[] };

/**
 * What a package's public text and tracks would break today, in the package's own workspace only (Hard Rule 9).
 * `blocking` refuses public text and holds Approve and the publisher; `sameArtist` is a review note.
 */
export async function embargoProblems(ctx: QueryCtx, workspace: Workspace, input: EmbargoInput): Promise<{ blocking: string[]; sameArtist: string[] }> {
  return embargoHits(input, await activeEmbargoes(ctx, workspace, chicagoDayKey(Date.now())));
}

/**
 * The refusal lines a public description gets, one per blocking match. A person reads the release named in full; the
 * agent reads only its own words (Hard Rule 10: an embargoed release's artist or title never reaches the agent).
 */
export async function descriptionEmbargoes(ctx: QueryCtx, workspace: Workspace, description: unknown, reader: "agent" | "human"): Promise<string[]> {
  if (typeof description !== "string") return [];
  const active = await activeEmbargoes(ctx, workspace, chicagoDayKey(Date.now()));
  if (reader === "agent") return agentEmbargoLines({ description }, active).map((l) => `${l} Leave it out.`);
  return embargoHits({ description }, active).blocking.map((b) => `${b}. Leave it out.`);
}

/**
 * The package page's view: each blocking line with its release, for the "Clear embargo" button. A private view.
 * `today` is the browser's Chicago day: a subscribed query never re-runs because time passed (like publishState).
 */
export async function embargoView(ctx: QueryCtx, workspace: Workspace, input: EmbargoInput, today: string) {
  const rows = (await embargoedRows(ctx, workspace, today)).map((r) => ({ ...asActive(r), releaseId: r._id }));
  const { blocking, sameArtist } = embargoMatches(input, rows);
  return { blocking: blocking.map(({ embargo }) => ({ releaseId: embargo.releaseId, text: describeEmbargo(embargo) })), sameArtist: sameArtist.map(describeEmbargo) };
}

/**
 * A published show's tracks were played: a matching real release goes to `played` from new or considering, never
 * from passed (Tarik's call stands). Called by publisher.result on success.
 */
export async function markPlayed(ctx: MutationCtx, tracks: { artist: string; title: string }[]): Promise<void> {
  const keys = new Set(tracks.map((t) => releaseKey(t.artist, t.title)));
  for (const key of keys) {
    const r = await ctx.db.query("releases").withIndex("by_workspace_key", (q) => q.eq("workspace", "real").eq("key", key)).first();
    const s = r && statusOf(r);
    if (s === "new" || s === "considering") await ctx.db.patch(r!._id, { status: "played", statusAt: Date.now() });
  }
}

export type AgentRelease = {
  id: Id<"releases">;
  artist: string;
  title: string;
  label?: string;
  genre?: string;
  type?: "album" | "single" | "ep";
  releasedOn?: string;
  tags?: string[];
  status: Infer<typeof releaseStatusV>;
  tab: Infer<typeof radarTabV>;
  embargo?: { until: string | null };
};

/**
 * The agent's read-only view (POST /agent/radar, the bridge's radar_get). Picked field by field: no links, player,
 * senders, subject, body or inbox, so no URL from an email ever reaches the agent. An actively embargoed release is left
 * out entirely (Hard Rules 5 and 10: embargoed items stay in private views).
 */
export const agentList = internalQuery({
  args: { workspace: workspaceV, status: v.optional(releaseStatusV), tab: v.optional(radarTabV) },
  handler: async (ctx, { workspace, status, tab }): Promise<AgentRelease[]> => {
    const today = chicagoDayKey(Date.now());
    const rows = await ctx.db.query("releases").withIndex("by_workspace", (q) => q.eq("workspace", workspace)).collect();
    return rows
      .filter((r) => !isEmbargoActive(r.embargo, today) && (!status || statusOf(r) === status) && (!tab || tabOf(r) === tab))
      .sort((a, b) => (b.receivedAt ?? b._creationTime) - (a.receivedAt ?? a._creationTime))
      .slice(0, MAX_AGENT)
      .map((r) => ({
        id: r._id,
        artist: r.artist,
        title: r.title,
        ...(r.label && { label: r.label }),
        ...(r.genre && { genre: r.genre }),
        ...(r.type && { type: r.type }),
        ...(r.releasedOn && { releasedOn: r.releasedOn }),
        // Task 6b: tags are checked short words and may help theme ideas. Never the about (untrusted page text).
        ...(r.tags?.length && { tags: r.tags }),
        status: statusOf(r),
        tab: tabOf(r),
        ...(r.embargo && { embargo: r.embargo }),
      }));
  },
});
