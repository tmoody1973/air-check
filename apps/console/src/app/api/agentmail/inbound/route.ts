import { MAX_SUBJECT_CHARS, cleanMail, parseAllowlist, pickInbound, senderDecision, stripLinks } from "@aircheck/core";
import { fetchMutation } from "convex/nextjs";
import { Webhook } from "svix";
import { api } from "../../../../../convex/_generated/api";
import { RADAR_INBOX, getMessage } from "@/lib/agentmail";

// AgentMail's message.received webhook for the release radar (Plan 8, ARCHITECTURE 3.7).
//
// The console receives and stores; it runs no model, fetches no link, opens no attachment and sends no email
// (Hard Rule 5). Public in proxy.ts because the caller is AgentMail, not a browser: its authentication is the
// Svix signature, checked against the raw body before anything is parsed. A stranger's text is never stored: the
// sender must be on RADAR_SENDERS with an aligned DKIM pass, or only an "ignored" row with its reason is kept.
// Logs carry the step and state only (Hard Rule 8).

const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_FROM = 320;

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/** The raw body, read no further than `max` bytes (null when over), so a chunked body with no Content-Length is capped too. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(req: Request) {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET?.trim();
  const token = process.env.INBOX_TOKEN?.trim();
  // Never skipped when unset: a webhook that stops verifying because a variable is missing is an open door.
  if (!secret || !token) return reply(503, { error: "not configured" });

  let webhook: Webhook;
  try {
    webhook = new Webhook(secret);
  } catch {
    return reply(503, { error: "not configured" }); // a malformed secret is our setup, not a bad delivery
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return reply(413, { error: "too large" });
  const raw = await readCapped(req, MAX_BODY_BYTES); // the signed bytes: parsing first and re-serialising would verify something else
  if (raw === null) return reply(413, { error: "too large" });

  let event: { event_type?: unknown; message?: unknown };
  try {
    webhook.verify(raw, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    });
    event = JSON.parse(raw);
  } catch {
    return reply(400, { error: "bad signature" });
  }
  if (event?.event_type !== "message.received") return reply(200, { ignored: true });
  // Only the radar's inbox: a delivery for any other inbox on the account is not ours to store or fetch.
  if ((event.message as { inbox_id?: unknown } | undefined)?.inbox_id !== RADAR_INBOX) return reply(200, { ignored: true });

  let mail = pickInbound(event.message);
  if (!mail) return reply(200, { ignored: true }); // no message id or sender: nothing to key a row on
  if (mail.bodyMissing) {
    try {
      mail = pickInbound(await getMessage(mail.messageId)) ?? mail;
    } catch {
      console.error("radar step=get-message ok=false");
      return reply(503, { error: "message not readable yet" }); // nothing written; Svix redelivers later
    }
  }

  const decision = senderDecision(mail, parseAllowlist(process.env.RADAR_SENDERS), process.env.RADAR_AUTHSERV_ID);
  const base = { token, messageId: mail.messageId, receivedAt: Date.now(), from: mail.from.slice(0, MAX_FROM) };
  // The subject is cut and cleaned for an ignored sender too: radar.received refuses a link or address in it.
  const clean = decision.ok ? cleanMail(mail, decision) : null;
  const args = decision.ok
    ? { ...base, subject: clean!.subject, mail: clean }
    : { ...base, subject: stripLinks(mail.subject.slice(0, MAX_SUBJECT_CHARS)).text, mail: null, ignoredReason: decision.reason };

  let fresh: boolean;
  try {
    ({ fresh } = await fetchMutation(api.radar.received, args));
  } catch {
    console.error("radar step=received ok=false");
    return reply(503, { error: "not stored" });
  }
  console.log(`radar step=received fresh=${fresh} state=${decision.ok ? "received" : "ignored"}`);
  return reply(200, { ok: true, fresh });
}
