import { readFileSync } from "node:fs";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The R12 catch-up script, with AgentMail played by a fetch spy and Convex by a fake client. Nothing leaves the machine.
const convex = vi.hoisted(() => ({ urls: [] as string[], calls: [] as { fn: unknown; args: Record<string, unknown> }[] }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) {
      convex.urls.push(url);
    }
    async mutation(fn: unknown, args: Record<string, unknown>) {
      convex.calls.push({ fn, args });
      return { fresh: true };
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
const FULL = new Map([tarik, bandcamp, forged, stranger].map((m) => [m.message_id as string, m]));

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
    expect(parseArgs(["--since", "2026-10-27", "--dry-run"])).toEqual({ since: new Date("2026-10-27T00:00:00Z"), dryRun: true });
    expect(parseArgs(["--since", "2026-10-27"])).toEqual({ since: new Date("2026-10-27T00:00:00Z"), dryRun: false });
    for (const bad of [[], ["--since"], ["--since", "yesterday"], ["--since", "2026-10-27", "--force"]]) expect(() => parseArgs(bad)).toThrow();
  });
});
