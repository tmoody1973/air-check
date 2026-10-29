import { readFileSync } from "node:fs";
import { getFunctionName, type FunctionReference } from "convex/server";
import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fixtures are signed here with a test secret. fetch is a spy and Convex is a fake that records calls and keeps one row
// per message id, the way radar.received does.
const SECRET = `whsec_${Buffer.from("test-secret-not-real-0123456789").toString("base64")}`;
const AUTHSERV = "mx.agentmail.invalid"; // the authserv-id the Task 1 fixtures use

type Call = { fn: string; args: Record<string, unknown> };
const convex = vi.hoisted(() => ({ calls: [] as { fn: unknown; args: Record<string, unknown> }[], rows: new Map<string, unknown>() }));
vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(async (fn: unknown, args: Record<string, unknown>) => {
    convex.calls.push({ fn, args });
    const id = args.messageId as string;
    if (convex.rows.has(id)) return { fresh: false };
    convex.rows.set(id, args);
    return { fresh: true };
  }),
  fetchQuery: vi.fn(async () => {
    throw new Error("the inbound route makes no queries");
  }),
  fetchAction: vi.fn(async () => {
    throw new Error("the inbound route calls no actions");
  }),
}));

const calls = (): Call[] => convex.calls.map((c) => ({ fn: getFunctionName(c.fn as FunctionReference<"mutation">), args: c.args }));
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../../../../fixtures/email/${name}`, import.meta.url), "utf8"));

const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
const logs: string[] = [];

beforeEach(() => {
  convex.calls.length = 0;
  convex.rows.clear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("AGENTMAIL_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("AGENTMAIL_API_KEY", "am_test_key");
  vi.stubEnv("INBOX_TOKEN", "inbox-token-for-tests-0123456789abcdef");
  vi.stubEnv("RADAR_SENDERS", "tarik@radiomilwaukee.org, noreply@bandcamp.com");
  vi.stubEnv("RADAR_AUTHSERV_ID", AUTHSERV);
  logs.length = 0;
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const event = (message: unknown, event_type = "message.received") => JSON.stringify({ event_type, message });

function signed(body: string, opts: { at?: Date; id?: string; secret?: string } = {}) {
  const id = opts.id ?? "msg_test_1";
  const at = opts.at ?? new Date();
  return {
    "svix-id": id,
    "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
    "svix-signature": new Webhook(opts.secret ?? SECRET).sign(id, at, body),
  };
}

async function post(body: string, headers: Record<string, string> = signed(body)) {
  const { POST } = await import("./route");
  return POST(new Request("http://internal:3000/api/agentmail/inbound", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
}

const LINKISH = /http|www\.|@/i;

describe("POST /api/agentmail/inbound: spoofing (Review Focus 5)", () => {
  it("serves only POST", async () => {
    expect(Object.keys(await import("./route"))).toEqual(["POST"]);
  });

  it("no secret → 503, nothing stored", async () => {
    vi.stubEnv("AGENTMAIL_WEBHOOK_SECRET", "");
    const body = event(fixture("cosign-forwarded.json"));
    expect((await post(body)).status).toBe(503);
    expect(convex.calls).toHaveLength(0);
  });

  it("no INBOX_TOKEN → 503, nothing stored", async () => {
    vi.stubEnv("INBOX_TOKEN", "");
    expect((await post(event(fixture("cosign-forwarded.json")))).status).toBe(503);
    expect(convex.calls).toHaveLength(0);
  });

  it("a wrong signature → 400", async () => {
    const body = event(fixture("cosign-forwarded.json"));
    const wrong = `whsec_${Buffer.from("some-other-secret-0123456789abcd").toString("base64")}`;
    expect((await post(body, signed(body, { secret: wrong }))).status).toBe(400);
    expect(convex.calls).toHaveLength(0);
  });

  it("a missing svix-signature → 400", async () => {
    const body = event(fixture("cosign-forwarded.json"));
    const { "svix-signature": _, ...rest } = signed(body);
    expect((await post(body, rest)).status).toBe(400);
    expect(convex.calls).toHaveLength(0);
  });

  it("a body changed by one byte after signing → 400", async () => {
    const body = event(fixture("cosign-forwarded.json"));
    const headers = signed(body);
    const changed = body.replace("Worth a spin", "Worth a spiN");
    expect(changed).not.toBe(body);
    expect(changed.length).toBe(body.length);
    expect((await post(changed, headers)).status).toBe(400);
    expect(convex.calls).toHaveLength(0);
  });

  it("a correctly signed delivery replayed 10 minutes later → 400", async () => {
    const body = event(fixture("cosign-forwarded.json"));
    expect((await post(body, signed(body, { at: new Date(Date.now() - 10 * 60_000) }))).status).toBe(400);
    expect(convex.calls).toHaveLength(0);
  });

  it("a body over 1.5 MB → 413, nothing stored", async () => {
    const body = event({ ...fixture("cosign-forwarded.json"), text: "a".repeat(1_600_000) });
    expect((await post(body)).status).toBe(413);
    expect(convex.calls).toHaveLength(0);
  });

  it("an allowlisted From whose DKIM failed → stored ignored with the reason and no body", async () => {
    const m = fixture("cosign-forwarded.json");
    m.headers["Authentication-Results"] = m.headers["Authentication-Results"].replace("dkim=pass", "dkim=fail");
    const res = await post(event(m));
    expect(res.status).toBe(200);
    const c = calls();
    expect(c).toHaveLength(1);
    expect(c[0]!.fn).toBe("radar:received");
    expect(c[0]!.args.mail).toBeNull();
    expect(c[0]!.args.ignoredReason).toBe("Sender's signature (DKIM) did not pass");
    expect(c[0]!.args.subject).not.toMatch(/:\/\/|@/);
    expect(logs).toContain("radar step=received fresh=true state=ignored");
  });

  it("RADAR_AUTHSERV_ID unset → every sender ignored as not set up", async () => {
    vi.stubEnv("RADAR_AUTHSERV_ID", "");
    expect((await post(event(fixture("cosign-forwarded.json")))).status).toBe(200);
    expect(calls()[0]!.args).toMatchObject({ mail: null, ignoredReason: "Air Check's sender check is not set up" });
  });

  it("a stranger's subject with links and addresses is cleaned before it is stored as ignored", async () => {
    const m = { ...fixture("cosign-forwarded.json"), from_: "Someone <x@evil.example>", subject: "Open https://evil.example/a or ftp://evil.example/b, mail x@evil.example" };
    expect((await post(event(m))).status).toBe(200);
    const c = calls()[0]!;
    expect(c.args).toMatchObject({ mail: null, ignoredReason: "Sender not on the list" });
    expect(c.args.subject).not.toMatch(/:\/\/|@|evil\.example/);
  });
});

describe("delivery (Review Focus 4)", () => {
  it("the same signed delivery twice → received twice, one stored row, fresh false the second time", async () => {
    const body = event(fixture("cosign-forwarded.json"));
    const headers = signed(body);
    expect((await post(body, headers)).status).toBe(200);
    expect((await post(body, headers)).status).toBe(200);
    expect(calls().map((c) => c.fn)).toEqual(["radar:received", "radar:received"]);
    expect(convex.rows.size).toBe(1);
    expect(logs).toEqual(["radar step=received fresh=true state=received", "radar step=received fresh=false state=received"]);
  });

  it("an event other than message.received → 200, no Convex call", async () => {
    const res = await post(event(fixture("cosign-forwarded.json"), "message.sent"));
    expect(res.status).toBe(200);
    expect(convex.calls).toHaveLength(0);
  });

  it("a signed body that is not JSON → 400, no Convex call", async () => {
    expect((await post("not json")).status).toBe(400);
    expect(convex.calls).toHaveLength(0);
  });
});

describe("links (Review Focus 2)", () => {
  it("7 links, one a Bandcamp album page: nothing fetched, nothing link-shaped stored", async () => {
    expect((await post(event(fixture("cosign-forwarded.json")))).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const c = calls();
    expect(c).toHaveLength(1);
    const mail = c[0]!.args.mail as { body: string; subject: string; links: string[]; bandcampPages: string[]; tab: string };
    expect(mail.body).not.toMatch(LINKISH);
    expect(mail.subject).not.toMatch(LINKISH);
    expect(c[0]!.args.subject).not.toMatch(LINKISH);
    expect(mail.links).toHaveLength(7);
    expect(mail.bandcampPages).toHaveLength(1);
    expect(mail.tab).toBe("cosign");
  });

  it("logs only the step line: no address, subject or URL", async () => {
    await post(event(fixture("cosign-forwarded.json")));
    expect(logs).toEqual(["radar step=received fresh=true state=received"]);
  });
});

describe("tabs", () => {
  it("a Bandcamp email → bandcamp", async () => {
    await post(event(fixture("bandcamp-label.json")));
    expect((calls()[0]!.args.mail as { tab: string }).tab).toBe("bandcamp");
  });
  it("a hand-forwarded Bandcamp email → bandcamp", async () => {
    await post(event(fixture("bandcamp-hand-forwarded.json")));
    expect((calls()[0]!.args.mail as { tab: string }).tab).toBe("bandcamp");
  });
  it("a co-sign → cosign", async () => {
    await post(event(fixture("cosign-embargo.json")));
    expect((calls()[0]!.args.mail as { tab: string }).tab).toBe("cosign");
  });
});

describe("body over 1 MB (AgentMail leaves it out)", () => {
  const bare = () => {
    const { text: _t, html: _h, ...m } = fixture("cosign-forwarded.json");
    return m;
  };

  it("bodyMissing → one getMessage, then stored", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(fixture("cosign-forwarded.json")), { status: 200 }));
    expect((await post(event(bare()))).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toMatch(/\/inboxes\/rhythmlab%40agentmail\.to\/messages\//);
    const mail = calls()[0]!.args.mail as { body: string; links: string[] };
    expect(mail.body).toMatch(/Song Title/);
    expect(mail.links).toHaveLength(7);
  });

  it("getMessage failing → 503, no Convex call", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect((await post(event(bare()))).status).toBe(503);
    expect(convex.calls).toHaveLength(0);
  });
});

describe("only one Convex function", () => {
  it("every Convex call is radar.received, with INBOX_TOKEN", async () => {
    for (const f of ["cosign-forwarded.json", "bandcamp-label.json", "cosign-injection.json"]) await post(event(fixture(f)));
    const c = calls();
    expect(c.length).toBe(3);
    for (const x of c) {
      expect(x.fn).toBe("radar:received");
      expect(x.args.token).toBe("inbox-token-for-tests-0123456789abcdef");
    }
  });

  it("the route source names no other Convex function and no model, send or attachment call", () => {
    const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect([...src.matchAll(/\bapi\.[\w.]+/g)].map((m) => m[0])).toEqual(["api.radar.received"]);
    expect(src).not.toMatch(/fetchQuery|fetchAction|after\(|attachments|messages\/send|tokenfactory|openai|anthropic/i);
  });

  it("Convex failing → 503 so Svix redelivers, with a bare log line", async () => {
    const { fetchMutation } = await import("convex/nextjs");
    vi.mocked(fetchMutation).mockRejectedValueOnce(new Error("Server Error tarik@radiomilwaukee.org"));
    expect((await post(event(fixture("cosign-forwarded.json")))).status).toBe(503);
    expect(logs.join("\n")).not.toMatch(/@|Server Error/);
  });
});
