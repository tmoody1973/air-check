import { readFileSync } from "node:fs";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The R12 catch-up script, with AgentMail played by a fetch spy and Convex by a fake client. Nothing leaves the machine.
const convex = vi.hoisted(() => ({ urls: [] as string[], calls: [] as { fn: unknown; args: Record<string, unknown> }[], fail: [] as unknown[], answers: [] as unknown[] }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) {
      convex.urls.push(url);
    }
    async mutation(fn: unknown, args: Record<string, unknown>) {
      convex.calls.push({ fn, args });
      if (convex.fail.length) throw convex.fail.shift();
      return convex.answers.length ? convex.answers.shift() : { fresh: true };
    }
  },
}));

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/email/${name}.json`, import.meta.url), "utf8"));
const API = "https://api.agentmail.to/v0/inboxes/rhythmlab%40agentmail.to/messages";

// What AgentMail's list returns: no body. Each listed sender's message is then read in full, with its verdict.
const item = (m: Record<string, unknown>, timestamp: string) => ({
  inbox_id: "rhythmlab@agentmail.to",
  message_id: m.message_id,
  from: m.from_,
  subject: m.subject,
  preview: "Secret preview words",
  labels: m.labels,
  timestamp,
});
const tarik = fixture("cosign-forwarded");
const bandcamp = fixture("bandcamp-label");
const forged = { ...fixture("cosign-embargo"), authentication_results: { dmarc: "pass", dmarc_domain: "attacker.com" } };
const stranger = { ...fixture("cosign-injection"), message_id: "<stranger@evil.example>", from_: "Promo <promo@evil.example>" };
const PAGES: Record<string, unknown> = {
  first: { count: 2, messages: [item(tarik, "2026-10-27T15:00:00Z"), item(stranger, "2026-10-27T16:00:00Z")], next_page_token: "page 2" },
  "page 2": { count: 2, messages: [item(forged, "2026-10-28T15:00:00Z"), item(bandcamp, "2026-10-29T15:00:00Z")] },
};
const preorder = fixture("bandcamp-preorder");
const FULL = new Map([tarik, bandcamp, forged, stranger, preorder].map((m) => [m.message_id as string, m]));

const fetchSpy = vi.fn(async (url: string | URL | Request) => {
  const u = new URL(String(url));
  if (u.origin + u.pathname === API) return Response.json(PAGES[u.searchParams.get("page_token") ?? "first"]);
  const m = FULL.get(decodeURIComponent(u.pathname.slice(new URL(API).pathname.length + 1)));
  return m ? Response.json(m) : new Response("{}", { status: 404 });
});

const out: string[] = [];
const print = (line: string) => void out.push(line);
const SECRETS = { AGENTMAIL_API_KEY: "am_test_key_SECRET", INBOX_TOKEN: "inbox-token-SECRET-0123456789abcdef0123456789" };

beforeEach(() => {
  out.length = 0;
  convex.urls.length = 0;
  convex.calls.length = 0;
  convex.fail.length = 0;
  convex.answers.length = 0;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("AGENTMAIL_API_KEY", SECRETS.AGENTMAIL_API_KEY);
  vi.stubEnv("INBOX_TOKEN", SECRETS.INBOX_TOKEN);
  vi.stubEnv("RADAR_SENDERS", "tarik@radiomilwaukee.org, noreply@bandcamp.com");
  vi.stubEnv("CONVEX_URL", "https://prod-example.convex.cloud");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const SINCE = new Date("2026-10-27T00:00:00Z");
const EXPECTED = [
  "#1 kept",
  "#2 ignored Sender not on the list",
  "#3 ignored AgentMail could not confirm the sender",
  "#4 kept",
];

/** Nothing the email or the setup holds: no address, subject, body, preview, message id or secret. */
function expectNothingPrivate(lines: string[]) {
  const text = lines.join("\n");
  expect(text).not.toMatch(/@|https?:|SECRET|Secret|preview/i);
  for (const m of FULL.values()) expect(text).not.toContain(String(m.subject));
}

describe("radar-backfill", () => {
  it("--dry-run: pages through the inbox oldest first, decides each message, writes nothing, prints codes only", async () => {
    const { backfill } = await import("./radar-backfill");
    expect(await backfill({ since: SINCE, dryRun: true }, print)).toBe(0);
    expect(out).toEqual([...EXPECTED, "4 messages: 2 kept, 2 ignored, 0 skipped, 0 failed (dry run: nothing written)"]);
    expectNothingPrivate(out);
    expect(convex.urls).toEqual([]);
    expect(convex.calls).toEqual([]);

    const urls = fetchSpy.mock.calls.map((c) => new URL(String(c[0])));
    const lists = urls.filter((u) => u.origin + u.pathname === API);
    expect(lists.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      { after: "2026-10-27T00:00:00.000Z", ascending: "true", limit: "100" },
      { after: "2026-10-27T00:00:00.000Z", ascending: "true", limit: "100", page_token: "page 2" },
    ]);
    // Only the three listed senders cost a read; the stranger does not.
    expect(urls.length - lists.length).toBe(3);
  });

  it("a real run stores each message through radar.received, with the message's own time", async () => {
    const { backfill } = await import("./radar-backfill");
    expect(await backfill({ since: SINCE, dryRun: false }, print)).toBe(0);
    expect(out).toEqual([...EXPECTED, "4 messages: 2 kept, 2 ignored, 0 skipped, 0 failed"]);
    expectNothingPrivate(out);
    expect(convex.urls).toEqual(["https://prod-example.convex.cloud"]);
    expect(convex.calls.map((c) => getFunctionName(c.fn as FunctionReference<"mutation">))).toEqual(Array(4).fill("radar:received"));
    expect(convex.calls.map((c) => c.args.token)).toEqual(Array(4).fill(SECRETS.INBOX_TOKEN));
    expect(convex.calls.map((c) => c.args.receivedAt)).toEqual(["2026-10-27T15:00:00Z", "2026-10-27T16:00:00Z", "2026-10-28T15:00:00Z", "2026-10-29T15:00:00Z"].map(Date.parse));
    expect(convex.calls.map((c) => c.args.mail === null)).toEqual([false, true, true, false]);
  });

  it("a message that cannot be read counts as failed, the rest go on, and the exit code says so", async () => {
    FULL.delete(bandcamp.message_id);
    try {
      const { backfill } = await import("./radar-backfill");
      expect(await backfill({ since: SINCE, dryRun: true }, print)).toBe(1);
      expect(out).toEqual([...EXPECTED.slice(0, 3), "#4 failed (AgentMail)", "4 messages: 1 kept, 2 ignored, 0 skipped, 1 failed (dry run: nothing written)"]);
    } finally {
      FULL.set(bandcamp.message_id, bandcamp);
    }
  });

  it("a Convex failure prints its error code only (never the message, subject, sender, id or a secret)", async () => {
    const { ConvexError } = await import("convex/values");
    convex.fail.push(
      new ConvexError({ code: "UNAUTHORIZED" }),
      new ConvexError({ code: "BAD_INPUT", message: "detail tarik@radiomilwaukee.org" }),
      new Error(`boom ${SECRETS.INBOX_TOKEN}`),
      new ConvexError({ code: "not a code <x@evil.example>" }),
    );
    const { backfill } = await import("./radar-backfill");
    expect(await backfill({ since: SINCE, dryRun: false }, print)).toBe(1);
    expect(out).toEqual([
      "#1 failed (Convex UNAUTHORIZED)",
      "#2 failed (Convex BAD_INPUT)",
      "#3 failed (Convex)",
      "#4 failed (Convex)",
      "4 messages: 0 kept, 0 ignored, 0 skipped, 4 failed",
    ]);
    expectNothingPrivate(out);
  });

  it("refuses to run without a sender list, or (for a real run) without the Convex URL and token", async () => {
    const { backfill } = await import("./radar-backfill");
    vi.stubEnv("RADAR_SENDERS", "");
    expect(await backfill({ since: SINCE, dryRun: true }, print)).toBe(2);
    vi.stubEnv("RADAR_SENDERS", "tarik@radiomilwaukee.org");
    for (const [name, value] of [["CONVEX_URL", ""], ["CONVEX_URL", "http://insecure.example"], ["INBOX_TOKEN", ""]]) {
      vi.stubEnv("CONVEX_URL", "https://prod-example.convex.cloud");
      vi.stubEnv("INBOX_TOKEN", SECRETS.INBOX_TOKEN);
      vi.stubEnv(name!, value!);
      expect(await backfill({ since: SINCE, dryRun: false }, print)).toBe(2);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNothingPrivate(out);
  });

  it("a list failure stops with the status only", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("detail tarik@radiomilwaukee.org", { status: 500 }));
    const { backfill } = await import("./radar-backfill");
    expect(await backfill({ since: SINCE, dryRun: true }, print)).toBe(1);
    expect(out).toEqual(["Listing the inbox failed: AgentMail 500"]);
  });

  it("parseArgs: --since is a required date; --dry-run is a flag", async () => {
    const { parseArgs } = await import("./radar-backfill");
    expect(parseArgs(["--since", "2026-10-27", "--dry-run"])).toEqual({ since: new Date("2026-10-27T00:00:00Z"), dryRun: true, reparse: false });
    expect(parseArgs(["--since", "2026-10-27"])).toEqual({ since: new Date("2026-10-27T00:00:00Z"), dryRun: false, reparse: false });
    expect(parseArgs(["--reparse", "--since", "2026-10-27", "--dry-run"])).toEqual({ since: new Date("2026-10-27T00:00:00Z"), dryRun: true, reparse: true });
    for (const bad of [[], ["--since"], ["--since", "yesterday"], ["--since", "2026-10-27", "--force"]]) expect(() => parseArgs(bad)).toThrow();
  });
});

// Listening-queue brief B: --reparse runs the fixed Bandcamp parser on each kept Bandcamp email's cleaned text and asks
// radar.reparse to repair the release that email made. It prints outcomes and counts only.
describe("radar-backfill --reparse", () => {
  const name = (c: { fn: unknown }) => getFunctionName(c.fn as FunctionReference<"mutation">);

  it.each([true, false])("dryRun=%s: only the kept Bandcamp email is sent, with the parser's fields; nothing else is stored", async (dryRun) => {
    convex.answers.push({ result: "repaired", requeued: true });
    const { reparse } = await import("./radar-backfill");
    expect(await reparse({ since: SINCE, dryRun }, print)).toBe(0);
    expect(out).toEqual([
      "#1 skipped (not a kept Bandcamp email)",
      "#2 skipped (not a kept Bandcamp email)",
      "#3 skipped (not a kept Bandcamp email)",
      "#4 repaired requeued",
      `4 messages: 1 repaired, 0 unchanged, 0 collision, 0 not-found, 1 requeued, 3 skipped, 0 failed${dryRun ? " (dry run: nothing written)" : ""}`,
    ]);
    expectNothingPrivate(out);
    expect(convex.calls.map(name)).toEqual(["radar:reparse"]);
    expect(convex.calls[0]!.args).toEqual({
      token: SECRETS.INBOX_TOKEN,
      messageId: bandcamp.message_id,
      fields: { artist: "Ferro Lane", title: "Glass Weather", label: "Pale Signal Records" },
      dryRun,
    });
  });

  it("each outcome prints as one word; a Bandcamp email the template does not match is skipped", async () => {
    PAGES.first = { count: 5, messages: ["a", "b", "c", "d"].map((x) => item({ ...bandcamp, message_id: `<${x}@t>` }, "2026-10-29T15:00:00Z")).concat(item(preorder, "2026-10-29T16:00:00Z")) };
    for (const x of ["a", "b", "c", "d"]) FULL.set(`<${x}@t>`, { ...bandcamp, message_id: `<${x}@t>` });
    try {
      convex.answers.push({ result: "unchanged", requeued: false }, { result: "collision", requeued: false }, { result: "not-found", requeued: false }, { result: "repaired", requeued: false });
      const { reparse } = await import("./radar-backfill");
      expect(await reparse({ since: SINCE, dryRun: false }, print)).toBe(0);
      expect(out).toEqual([
        "#1 unchanged",
        "#2 collision",
        "#3 not-found",
        "#4 repaired",
        "#5 skipped (template did not match)",
        "5 messages: 1 repaired, 1 unchanged, 1 collision, 1 not-found, 0 requeued, 1 skipped, 0 failed",
      ]);
    } finally {
      PAGES.first = { count: 2, messages: [item(tarik, "2026-10-27T15:00:00Z"), item(stranger, "2026-10-27T16:00:00Z")], next_page_token: "page 2" };
      for (const x of ["a", "b", "c", "d"]) FULL.delete(`<${x}@t>`);
    }
  });

  it("a Convex failure prints only its code", async () => {
    const { ConvexError } = await import("convex/values");
    convex.fail.push(new ConvexError({ code: "UNAUTHORIZED", message: `no ${SECRETS.INBOX_TOKEN}` }));
    const { reparse } = await import("./radar-backfill");
    expect(await reparse({ since: SINCE, dryRun: false }, print)).toBe(1);
    expect(out.at(-2)).toBe("#4 failed (Convex UNAUTHORIZED)");
    expectNothingPrivate(out);
  });

  it("needs the Convex URL and token even for a dry run (the dry run asks Convex what it would do)", async () => {
    const { reparse } = await import("./radar-backfill");
    vi.stubEnv("INBOX_TOKEN", "");
    expect(await reparse({ since: SINCE, dryRun: true }, print)).toBe(2);
    vi.stubEnv("INBOX_TOKEN", SECRETS.INBOX_TOKEN);
    vi.stubEnv("CONVEX_URL", "http://insecure.example");
    expect(await reparse({ since: SINCE, dryRun: true }, print)).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
