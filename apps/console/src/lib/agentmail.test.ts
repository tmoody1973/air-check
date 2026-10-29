import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetch is a spy: nothing here reaches AgentMail.
const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("AGENTMAIL_API_KEY", "am_test_key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("agentmail client", () => {
  it("exports only the inbox, two reads and its error (no send, reply, draft or attachments)", async () => {
    expect(Object.keys(await import("./agentmail")).sort()).toEqual(["AgentMailError", "RADAR_INBOX", "getMessage", "listMessages"]);
    const { RADAR_INBOX } = await import("./agentmail");
    expect(RADAR_INBOX).toBe("rhythmlab@agentmail.to");
  });

  it("GETs one message from the radar inbox with the Bearer key, no-store and a timeout", async () => {
    const { getMessage } = await import("./agentmail");
    fetchSpy.mockResolvedValue(json({ message_id: "<a@b>" }));
    expect((await getMessage("<a@b>")).message).toEqual({ message_id: "<a@b>" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.agentmail.to/v0/inboxes/rhythmlab%40agentmail.to/messages/%3Ca%40b%3E");
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer am_test_key");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("waits and retries once on 429 Retry-After", async () => {
    const { getMessage } = await import("./agentmail");
    fetchSpy.mockResolvedValueOnce(json({}, 429, { "retry-after": "0" })).mockResolvedValueOnce(json({ ok: 1 }));
    expect((await getMessage("m1")).message).toEqual({ ok: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("a 429 with no Retry-After waits 1 s before the retry", async () => {
    vi.useFakeTimers();
    try {
      const { getMessage } = await import("./agentmail");
      fetchSpy.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ ok: 1 }));
      const got = getMessage("m1");
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await got).message).toEqual({ ok: 1 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second 429 throws AgentMailError(429); no third try", async () => {
    const { getMessage, AgentMailError } = await import("./agentmail");
    fetchSpy.mockResolvedValue(json({}, 429, { "retry-after": "0" }));
    const err = await getMessage("m1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentMailError);
    expect((err as InstanceType<typeof AgentMailError>).status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("an error carries the status and none of the body text", async () => {
    const { getMessage, AgentMailError } = await import("./agentmail");
    fetchSpy.mockResolvedValue(new Response("secret detail tarik@radiomilwaukee.org", { status: 500 }));
    const err = (await getMessage("m1").catch((e: unknown) => e)) as InstanceType<typeof AgentMailError>;
    expect(err).toBeInstanceOf(AgentMailError);
    expect(err.status).toBe(500);
    expect(err.message).not.toMatch(/secret|tarik|@/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("getMessage returns AgentMail's verdict, shape-checked (R12)", async () => {
    const { getMessage } = await import("./agentmail");
    const live = { message_id: "m", authentication_results: { dkim: "none", dmarc: "pass", dmarc_domain: "bandcamp.com" }, labels: ["received", "unread"] };
    fetchSpy.mockResolvedValueOnce(json(live));
    expect((await getMessage("m")).verdict).toEqual({ auth: { dmarc: "pass", dmarc_domain: "bandcamp.com" }, labels: ["received", "unread"] });
    fetchSpy.mockResolvedValueOnce(json({ message_id: "m", authentication_results: "pass", labels: { 0: "received" } }));
    expect((await getMessage("m")).verdict).toEqual({ auth: null, labels: null });
  });

  it("listMessages: the radar inbox since a date, oldest first, one page per call", async () => {
    const { listMessages } = await import("./agentmail");
    fetchSpy.mockResolvedValueOnce(json({ count: 1, messages: [{ message_id: "a" }], next_page_token: "tok 2" }));
    expect(await listMessages(new Date("2026-10-27T05:00:00Z"))).toEqual({ messages: [{ message_id: "a" }], nextPageToken: "tok 2" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.agentmail.to/v0/inboxes/rhythmlab%40agentmail.to/messages");
    expect(Object.fromEntries(u.searchParams)).toEqual({ after: "2026-10-27T05:00:00.000Z", ascending: "true", limit: "100" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer am_test_key");
    fetchSpy.mockResolvedValueOnce(json({ count: 0, messages: [] }));
    expect(await listMessages(new Date("2026-10-27T05:00:00Z"), "tok 2")).toEqual({ messages: [] });
    expect(new URL((fetchSpy.mock.calls[1] as [string])[0]).searchParams.get("page_token")).toBe("tok 2");
  });

  it("listMessages: a page with no messages array is an error, not an empty inbox", async () => {
    const { listMessages } = await import("./agentmail");
    fetchSpy.mockResolvedValueOnce(json({ count: 1 }));
    await expect(listMessages(new Date())).rejects.toThrow();
  });

  it("no API key → throws before any request", async () => {
    vi.stubEnv("AGENTMAIL_API_KEY", "");
    const { getMessage } = await import("./agentmail");
    await expect(getMessage("m1")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
