import { readFile } from "node:fs/promises";
import { readyCard } from "@aircheck/core";
import type { PublisherConvex } from "./convex.js";
import type { StateBox } from "./state.js";
import { timed } from "./log.js";

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 15_000;
export const RECONNECT_ALERT = "Mixcloud needs reconnecting: open Settings";

export interface TelegramSecrets { botToken: string; chatId: string }

/** Only the two values, read exactly as deploy/hermes/watchdog.sh does. Missing file or value: null. */
export async function readTelegramSecrets(path: string): Promise<TelegramSecrets | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  const value = (name: string) => text.split("\n").find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim() ?? "";
  const botToken = value("TELEGRAM_BOT_TOKEN");
  const chatId = value("TELEGRAM_ALLOWED_IDS").split(",")[0]!.trim();
  return botToken && chatId ? { botToken, chatId } : null;
}

/**
 * A sender that never throws: true when Telegram took the message. Secrets are read per send, so a rotated bot
 * token needs no restart. The bot token sits in the URL path (Telegram's API); that URL is never logged.
 */
export function telegramSender(secretsFile: string, apiBase = TELEGRAM_API): (text: string) => Promise<boolean> {
  return async (text) => {
    try {
      const s = await readTelegramSecrets(secretsFile);
      if (!s) return false;
      const res = await fetch(`${apiBase}/bot${s.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: s.chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    }
  };
}

export interface CardDeps {
  convex: Pick<PublisherConvex, "awaitingReview">; state: StateBox; appUrl: string;
  send: (text: string) => Promise<boolean>; log: (line: string) => void;
}

/**
 * One "ready for review" card per package newly waiting for review: a review link only, never an approve button
 * (approval happens in the signed-in console). Sent ids persist, so a restart never re-sends; a failed send is
 * tried again next time. Ids that left review are dropped, so a package that comes back gets a fresh card.
 */
export async function sendReadyCards(deps: CardDeps): Promise<void> {
  const waiting = await deps.convex.awaitingReview();
  for (const p of waiting) {
    if (deps.state.get().sentCards.includes(p.packageId)) continue;
    const ok = await timed(deps.log, p.packageId, "card", () => deps.send(readyCard({ ...p, appUrl: deps.appUrl })), (sent) => sent);
    if (ok) await deps.state.update((s) => ({ ...s, sentCards: [...s.sentCards, p.packageId] }));
  }
  const ids = new Set(waiting.map((p) => p.packageId));
  if (deps.state.get().sentCards.some((id) => !ids.has(id)))
    await deps.state.update((s) => ({ ...s, sentCards: s.sentCards.filter((id) => ids.has(id)) }));
}
