import {
  MAX_SUBJECT_CHARS,
  cleanMail,
  isListedSender,
  pickInbound,
  senderDecision,
  stripLinks,
  type CleanMail,
  type SenderVerdict,
} from "@aircheck/core";

// One AgentMail message → one radar.received call (Plan 8, ruling R12). Shared by the webhook route and the one-off
// catch-up script, so both decide the same way. It runs no model, fetches no link, opens no attachment and sends no
// email (Hard Rule 5). A stranger's text is never stored: the sender must be on the list and AgentMail's own verdict,
// read from its API (never from the email), must confirm it; otherwise only an "ignored" row with its reason is kept.

const MAX_FROM = 320;

export type ReceivedArgs = {
  token: string;
  messageId: string;
  receivedAt: number;
  from: string;
  subject: string;
  mail: CleanMail | null;
  ignoredReason?: string;
};

export interface InboundDeps {
  token: string;
  allowlist: string[];
  getMessage: (messageId: string) => Promise<{ message: unknown; verdict: SenderVerdict }>;
  received: (args: ReceivedArgs) => Promise<{ fresh: boolean }>;
}

export type InboundResult =
  | { status: "skipped" } // no message id or sender: nothing to key a row on
  | { status: "unreadable" } // AgentMail could not be read: nothing written, try again later
  | { status: "unstored" } // Convex refused or failed: nothing written, try again later
  | { status: "stored"; fresh: boolean; kept: true }
  | { status: "stored"; fresh: boolean; kept: false; reason: string };

export async function handleInbound(message: unknown, deps: InboundDeps, receivedAt = Date.now()): Promise<InboundResult> {
  let mail = pickInbound(message);
  if (!mail) return { status: "skipped" };

  // Only a listed sender costs an AgentMail call: the verdict, and the body when it was left out (over 1 MB, or a list item).
  let verdict: SenderVerdict | null = null;
  if (isListedSender(mail.from, deps.allowlist)) {
    try {
      const fetched = await deps.getMessage(mail.messageId);
      verdict = fetched.verdict;
      if (mail.bodyMissing) mail = pickInbound(fetched.message) ?? mail;
    } catch {
      return { status: "unreadable" };
    }
  }

  const decision = senderDecision(mail, deps.allowlist, verdict);
  const base = { token: deps.token, messageId: mail.messageId, receivedAt, from: mail.from.slice(0, MAX_FROM) };
  // The subject is cut and cleaned for an ignored sender too: radar.received refuses a link or address in it.
  let args: ReceivedArgs;
  if (decision.ok) {
    const clean = cleanMail(mail, decision);
    args = { ...base, subject: clean.subject, mail: clean };
  } else {
    args = { ...base, subject: stripLinks(mail.subject.slice(0, MAX_SUBJECT_CHARS)).text, mail: null, ignoredReason: decision.reason };
  }

  let fresh: boolean;
  try {
    ({ fresh } = await deps.received(args));
  } catch {
    return { status: "unstored" };
  }
  return decision.ok ? { status: "stored", fresh, kept: true } : { status: "stored", fresh, kept: false, reason: decision.reason };
}
