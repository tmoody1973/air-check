// The AgentMail API boundary: the one file that names AgentMail's host. Server-only; the key never reaches a browser.
// It reads one message and nothing else: no send, reply, draft, allow-list or attachments call (Plan 8).

const BASE = "https://api.agentmail.to/v0";
const TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 5_000; // ponytail: Svix waits ~15 s for our answer; a longer Retry-After waits 5 s, then fails into a redelivery

/** The radar's inbox. A constant, not env: an inbox that can differ between environments is a way to read the wrong one. */
export const RADAR_INBOX = "rhythmlab@agentmail.to";

/** A failed AgentMail request. The status only: the body can hold message text, so it is never kept. */
export class AgentMailError extends Error {
  constructor(readonly status: number) {
    super(`AgentMail ${status}`);
    this.name = "AgentMailError";
  }
}

/** One message, read live (the webhook leaves the body out over 1 MB). One wait-and-retry on 429. */
export async function getMessage(messageId: string): Promise<unknown> {
  const key = process.env.AGENTMAIL_API_KEY?.trim();
  if (!key) throw new Error("AGENTMAIL_API_KEY is not configured");
  const url = `${BASE}/inboxes/${encodeURIComponent(RADAR_INBOX)}/messages/${encodeURIComponent(messageId)}`;
  const get = () =>
    fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });

  let res = await get();
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : 1000));
    res = await get();
  }
  if (!res.ok) throw new AgentMailError(res.status);
  return res.json();
}
