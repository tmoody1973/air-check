// The AgentMail API boundary: the one file that names AgentMail's host. Server-only; the key never reaches a browser.
// It reads messages and nothing else: no send, reply, draft, allow-list or attachments call (Plan 8).

import { readVerdict, type SenderVerdict } from "@aircheck/core";

const BASE = "https://api.agentmail.to/v0";
const TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 5_000; // ponytail: Svix waits ~15 s for our answer; a longer Retry-After waits 5 s, then fails into a redelivery
const PAGE_SIZE = 100;

/** The radar's inbox. A constant, not env: an inbox that can differ between environments is a way to read the wrong one. */
export const RADAR_INBOX = "rhythmlab@agentmail.to";

/** A failed AgentMail request. The status only: the body can hold message text, so it is never kept. */
export class AgentMailError extends Error {
  constructor(readonly status: number) {
    super(`AgentMail ${status}`);
    this.name = "AgentMailError";
  }
}

const INBOX_URL = `${BASE}/inboxes/${encodeURIComponent(RADAR_INBOX)}/messages`;

/** One GET with the key. One wait-and-retry on 429. */
async function read(url: string): Promise<unknown> {
  const key = process.env.AGENTMAIL_API_KEY?.trim();
  if (!key) throw new Error("AGENTMAIL_API_KEY is not configured");
  const get = () =>
    fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });

  let res = await get();
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after") ?? NaN); // missing → NaN → the 1 s default, not 0
    await new Promise((r) => setTimeout(r, Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : 1000));
    res = await get();
  }
  if (!res.ok) throw new AgentMailError(res.status);
  return res.json();
}

/**
 * One message, read live: its body (the webhook leaves it out over 1 MB) and AgentMail's own sender verdict (R12), which
 * the sender check trusts because it comes from AgentMail's API with our key, never from the email.
 */
export async function getMessage(messageId: string): Promise<{ message: unknown; verdict: SenderVerdict }> {
  const message = await read(`${INBOX_URL}/${encodeURIComponent(messageId)}`);
  return { message, verdict: readVerdict(message) };
}

/** One page of the radar inbox's messages received after `after`, oldest first (the R12 catch-up). Items carry no body. */
export async function listMessages(after: Date, pageToken?: string): Promise<{ messages: unknown[]; nextPageToken?: string }> {
  const q = new URLSearchParams({ after: after.toISOString(), ascending: "true", limit: String(PAGE_SIZE) });
  if (pageToken) q.set("page_token", pageToken);
  const page = (await read(`${INBOX_URL}?${q}`)) as { messages?: unknown; next_page_token?: unknown } | null;
  if (!Array.isArray(page?.messages)) throw new Error("AgentMail list: no messages array");
  const next = page.next_page_token;
  return { messages: page.messages, ...(typeof next === "string" && next ? { nextPageToken: next } : {}) };
}
