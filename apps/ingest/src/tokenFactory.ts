// The one Token Factory client (CLAUDE.md conventions: one client module per provider). Plan 8's extractor only:
// one chat completion, no tools, no memory, no skills. Hard Rule 2: the key lives in ~/.aircheck/ingest.env and is
// sent only in this module's Authorization header, never logged.
import { call, readText, type Http } from "./http.js";

const CHAT_URL = "https://api.tokenfactory.nebius.com/v1/chat/completions";
/** The id verified in spike V1. */
export const EXTRACTOR_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const TIMEOUT_MS = 30_000;
const MAX_REPLY_BYTES = 1024 ** 2;

/** The first JSON object in the model's reply, or null on any failure (status, timeout, no object, bad JSON). */
export async function chatJson(http: Http, key: string, { system, user }: { system: string; user: string }): Promise<unknown | null> {
  try {
    const res = await call(
      http,
      CHAT_URL,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        // No `tools` key, ever: the extractor can only answer.
        body: JSON.stringify({ model: EXTRACTOR_MODEL, temperature: 0, max_tokens: 600, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      },
      TIMEOUT_MS,
    );
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const j = JSON.parse(await readText(res, MAX_REPLY_BYTES)) as { choices?: { message?: { content?: unknown } }[] };
    const content = j.choices?.[0]?.message?.content;
    return typeof content === "string" ? firstObject(content) : null;
  } catch {
    return null;
  }
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
