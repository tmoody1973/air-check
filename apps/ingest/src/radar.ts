import { checkExtractions, EXTRACTION_SKILL_TEXT, MAX_EMAIL_CHARS, parseBandcampEmail, stripLinks, type Extractions } from "@aircheck/core";
import type { PendingEmail, RadarConvex, RadarOutcome } from "./convex.js";
import type { Http } from "./http.js";
import { chatJson, type ChatFailure } from "./tokenFactory.js";

export interface RadarDeps {
  convex: RadarConvex;
  log: (line: string) => void;
  http: Http;
  /** null: the Token Factory key is not set; co-signs are recorded failed, Bandcamp emails still parse. */
  nebiusKey: string | null;
  now: () => number;
}

const NOT_SET_UP = "Air Check's reader is not set up";
const NO_ANSWER = "The reader gave no answer";
const NOT_A_RELEASE = "The reader found no release in this email";
const STILL_LINKED = "The stored email still holds a link or an address";
// Defence in depth: Convex refuses a stored body with :// or @, and the console strips www. links; nothing linkish
// reaches the model even if one slipped through.
const LINKISH = /:\/\/|www\.|@/i;
// Convex's record limits (radar.ts MAX_REASONS / MAX_REASON).
const MAX_REASONS = 10;
const MAX_REASON = 300;

/**
 * Plan 8: turn stored emails into releases, one at a time. Bandcamp's template is read in code; anything else goes to
 * the extractor (one no-tools Token Factory call whose input is the cleaned text only). Every answer is checked by
 * checkExtractions (each release on its own), and each email gets exactly one recorded outcome. Hard Rule 8: the log carries counts and states only.
 */
export async function radarPass(deps: RadarDeps): Promise<void> {
  for (const email of await deps.convex.pending()) {
    const t0 = deps.now();
    try {
      const { outcome, code } = await read(deps, email);
      await deps.convex.record(email.messageId, outcome);
      const ok = outcome.kind === "saved" || outcome.kind === "not-a-release";
      const reasons = outcome.kind === "saved" ? 0 : outcome.reasons.length;
      deps.log(`ingest step=radar-read ok=${ok} state=${outcome.kind} reasons=${reasons}${code ? ` code=${code}` : ""} ms=${deps.now() - t0}`);
    } catch {
      // The row stays received and is read again next pass.
      deps.log(`ingest step=radar-read ok=false state=error reasons=0 ms=${deps.now() - t0}`);
    }
  }
}

/** One email's outcome; `code` is the Token Factory client's short failure code, for the log only. */
async function read(deps: RadarDeps, email: PendingEmail): Promise<{ outcome: RadarOutcome; code?: ChatFailure }> {
  // The same text goes to the model and to checkExtraction, so every field is grounded in what the model saw.
  const raw = `Subject: ${email.subject}\n\n${email.body}`.slice(0, MAX_EMAIL_CHARS);
  // Convex never stores :// or @, so one here is a bug upstream: refuse. A www. form the stripper missed when the email
  // was stored (Oct 30: a forward's "www. co-sign. com") is stripped again, so Try again reads it.
  if (/:\/\/|@/.test(raw)) return { outcome: { kind: "refused", reasons: [STILL_LINKED] } };
  const text = stripLinks(raw).text;
  if (LINKISH.test(text)) return { outcome: { kind: "refused", reasons: [STILL_LINKED] } };
  let candidate: unknown = email.tab === "bandcamp" ? parseBandcampEmail(email.subject, email.body) : null;
  if (!candidate) {
    if (!deps.nebiusKey) return { outcome: { kind: "failed", reasons: [NOT_SET_UP] } };
    const answer = await chatJson(deps.http, deps.nebiusKey, { system: EXTRACTION_SKILL_TEXT, user: text });
    if ("code" in answer) return { outcome: { kind: "failed", reasons: [NO_ANSWER] }, code: answer.code };
    candidate = answer.json;
  }
  return { outcome: outcomeOf(checkExtractions(candidate, text, email.receivedAt)) };
}

// Decision 024: a roundup's other releases ride in `more`; a one-release email keeps the old two-key outcome.
function outcomeOf(x: Extractions): RadarOutcome {
  if (x.ok) {
    const [release, ...more] = x.releases;
    return { kind: "saved", release: release!, ...(more.length && { more }) };
  }
  if ("notRelease" in x) return { kind: "not-a-release", reasons: [NOT_A_RELEASE] };
  return { kind: "refused", reasons: x.reasons.slice(0, MAX_REASONS).map((r) => r.slice(0, MAX_REASON)) };
}
