// The one Token Factory client (CLAUDE.md conventions: one client module per provider). Plan 8's extractor only:
// one chat completion, no tools, no memory, no skills. Hard Rule 2: the key lives in ~/.aircheck/ingest.env and is
// sent only in this module's Authorization header, never logged.
import { call, readText, type Http } from "./http.js";

const CHAT_URL = "https://api.tokenfactory.nebius.com/v1/chat/completions";
/** The id verified in spike V1. */
export const EXTRACTOR_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const TIMEOUT_MS = 30_000;
const MAX_REPLY_BYTES = 1024 ** 2;
// R7: Nemotron reasons before it answers and can spend a small budget there, leaving `content: null`
// (FRICTION_LOG 2026-10-26). Thinking is switched off in the chat template; 4000 covers a model that ignores the switch.
const MAX_TOKENS = 4000;
const NO_THINKING = { enable_thinking: false };
/** Oct 30: strict JSON mode (Token Factory accepts it); a roundup reply had failed to parse (bad_json). */
const JSON_MODE = { type: "json_object" };

/** Why there is no answer: a short code for the log (Hard Rule 8), never the reply's text. */
export type ChatFailure = `http_${number}` | "timeout" | "network" | "empty" | "length" | "bad_json";
export type ChatResult = { json: unknown } | { json: null; code: ChatFailure };

const isTimeout = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as { name?: unknown } | null)?.name as string);

/**
 * The first JSON object in the model's reply, or null with a code. An HTTP 400 (a host that refuses
 * chat_template_kwargs or JSON mode) is tried once more without either, with the same timeout.
 */
export async function chatJson(http: Http, key: string, { system, user }: { system: string; user: string }): Promise<ChatResult> {
  const base = { model: EXTRACTOR_MODEL, temperature: 0, max_tokens: MAX_TOKENS, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  try {
    let res = await post(http, key, { ...base, chat_template_kwargs: NO_THINKING, response_format: JSON_MODE });
    if (res.status === 400) {
      await res.body?.cancel();
      res = await post(http, key, base);
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { json: null, code: `http_${res.status}` };
    }
    return answerOf(await readText(res, MAX_REPLY_BYTES));
  } catch (e) {
    // readText's too_large lands here too; a reply over 1 MB is not an answer this reader can use.
    return { json: null, code: isTimeout(e) ? "timeout" : (e as { message?: unknown } | null)?.message === "too_large" ? "bad_json" : "network" };
  }
}

// No `tools` key, ever: the extractor can only answer.
const post = (http: Http, key: string, body: object) =>
  call(http, CHAT_URL, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }, TIMEOUT_MS);

function answerOf(raw: string): ChatResult {
  let choice: { message?: { content?: unknown }; finish_reason?: unknown } | undefined;
  try {
    choice = (JSON.parse(raw) as { choices?: (typeof choice)[] }).choices?.[0];
  } catch {
    return { json: null, code: "bad_json" };
  }
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const json = firstObject(content);
  if (json !== null) return { json };
  if (choice?.finish_reason === "length") return { json: null, code: "length" };
  return { json: null, code: content.trim() ? "bad_json" : "empty" };
}

/** The first balanced {…} in `text` (strings and escapes respected), parsed; null when there is none. One linear pass. */
export function firstObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as unknown;
      } catch {
        return null;
      }
    }
  }
  return null;
}
