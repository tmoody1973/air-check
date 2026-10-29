// One-off catch-up for ruling R12 (the sender-check hotfix). Lists the radar inbox's messages since a date, oldest
// first, and runs each through the same handleInbound as the webhook, so mail refused by the old check (or never
// delivered while the webhook was paused) is stored now. Safe to run twice: radar.received keeps one row per message id
// (an "ignored" row gives way to a kept one). Prints codes and counts only: never a subject, sender, body or secret.
//
//   pnpm --filter console exec tsx scripts/radar-backfill.ts --since 2026-10-27 [--dry-run]
//
// --reparse (listening-queue brief B): for each kept Bandcamp email since the date, runs the fixed Bandcamp parser on the
// same cleaned text the ingest worker reads, and asks radar.reparse to repair the release that email made (and re-queue
// its page for the date). Prints repaired|unchanged|collision|not-found (+ requeued) and counts. --dry-run asks Convex what
// it would do and writes nothing, so it needs CONVEX_URL and INBOX_TOKEN too.
//
//   pnpm --filter console exec tsx scripts/radar-backfill.ts --reparse --since 2026-10-27 [--dry-run]
//
// Reads AGENTMAIL_API_KEY, INBOX_TOKEN, RADAR_SENDERS and CONVEX_URL (the production Convex URL, never the dev one in
// .env.local) from the environment, then from apps/console/.env.production.local and .env.local. See docs/DEPLOY.md.

import { pathToFileURL } from "node:url";
import { checkExtraction, MAX_EMAIL_CHARS, parseAllowlist, parseBandcampEmail } from "@aircheck/core";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { AgentMailError, getMessage, listMessages } from "../src/lib/agentmail";
import { handleInbound, type InboundResult, type ReceivedArgs } from "../src/lib/radarInbound";

const MAX_PAGES = 1_000; // ponytail: a page token that never ends stops here; 100,000 messages is far past this inbox

export type BackfillOptions = { since: Date; dryRun: boolean };
const USAGE = "Usage: radar-backfill.ts [--reparse] --since YYYY-MM-DD [--dry-run]";

export function parseArgs(argv: string[]): BackfillOptions & { reparse: boolean } {
  let since: Date | undefined;
  let dryRun = false;
  let reparse = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--reparse") reparse = true;
    else if (argv[i] === "--since" && argv[i + 1] && /^\d{4}-\d{2}-\d{2}/.test(argv[i + 1]!)) since = new Date(argv[++i]!);
    else throw new Error(`Unexpected argument: ${argv[i]}. ${USAGE}`);
  }
  if (!since || !Number.isFinite(since.getTime())) throw new Error("--since YYYY-MM-DD is required");
  return { since, dryRun, reparse };
}

const line = (n: number, r: InboundResult, dryRun: boolean): string => {
  switch (r.status) {
    case "skipped":
      return `#${n} skipped (no message id or sender)`;
    case "unreadable":
      return `#${n} failed (AgentMail)`;
    case "unstored":
      return `#${n} failed (Convex${r.code ? ` ${r.code}` : ""})`;
    case "stored":
      return `#${n} ${r.kept ? "kept" : `ignored ${r.reason}`}${!dryRun && !r.fresh ? " (already stored)" : ""}`;
  }
};

/** Exit code: 0 done, 1 something failed (run again: it is safe), 2 not set up. */
export async function backfill({ since, dryRun }: BackfillOptions, print: (line: string) => void): Promise<number> {
  const allowlist = parseAllowlist(process.env.RADAR_SENDERS);
  if (!allowlist.length) {
    print("RADAR_SENDERS is empty: every email would be ignored. Set it to the VM's value first.");
    return 2;
  }
  let received: (args: ReceivedArgs) => Promise<{ fresh: boolean }> = async () => ({ fresh: true });
  const token = process.env.INBOX_TOKEN?.trim() ?? "";
  if (!dryRun) {
    const url = process.env.CONVEX_URL?.trim() ?? "";
    if (!url.startsWith("https://") || !token) {
      print("A real run needs CONVEX_URL (the production https URL) and INBOX_TOKEN.");
      return 2;
    }
    const client = new ConvexHttpClient(url);
    received = (args) => client.mutation(api.radar.received, args);
  }

  const count = { kept: 0, ignored: 0, skipped: 0, failed: 0 };
  const n = await eachMessage(since, print, async (message, at, n) => {
    const r = await handleInbound(message, { token, allowlist, getMessage, received }, at);
    print(line(n, r, dryRun));
    if (r.status === "stored") count[r.kept ? "kept" : "ignored"]++;
    else count[r.status === "skipped" ? "skipped" : "failed"]++;
  });
  if (n === null) return 1;
  print(`${n} messages: ${count.kept} kept, ${count.ignored} ignored, ${count.skipped} skipped, ${count.failed} failed${dryRun ? " (dry run: nothing written)" : ""}`);
  return count.failed ? 1 : 0;
}

/** Every inbox message since the date, oldest first, with its own time. The count, or null when listing failed (printed). */
async function eachMessage(since: Date, print: (line: string) => void, run: (message: unknown, at: number, n: number) => Promise<void>): Promise<number | null> {
  let n = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let messages: unknown[];
    try {
      ({ messages, nextPageToken: pageToken } = await listMessages(since, pageToken));
    } catch (e) {
      print(`Listing the inbox failed: ${e instanceof AgentMailError ? e.message : "no answer"}`);
      return null;
    }
    for (const message of messages) {
      const at = Date.parse(String((message as { timestamp?: unknown } | null)?.timestamp ?? ""));
      await run(message, Number.isFinite(at) ? at : Date.now(), ++n);
    }
    if (!pageToken) break;
  }
  return n;
}

/** ConvexError's code when it is a plain word; never the message, which can quote what was sent. */
const codeOf = (e: unknown) => {
  const code = (e as { data?: { code?: unknown } } | null)?.data?.code;
  return typeof code === "string" && /^[A-Z_]{1,32}$/.test(code) ? ` ${code}` : "";
};

type ReparseAnswer = { result: "repaired" | "unchanged" | "collision" | "not-found"; requeued: boolean };

/** --reparse: repair releases the old Bandcamp parser stored wrong. Exit code: 0 done, 1 something failed, 2 not set up. */
export async function reparse({ since, dryRun }: BackfillOptions, print: (line: string) => void): Promise<number> {
  const allowlist = parseAllowlist(process.env.RADAR_SENDERS);
  const token = process.env.INBOX_TOKEN?.trim() ?? "";
  const url = process.env.CONVEX_URL?.trim() ?? "";
  if (!allowlist.length || !url.startsWith("https://") || !token) {
    print("--reparse needs RADAR_SENDERS, CONVEX_URL (the production https URL) and INBOX_TOKEN, also for a dry run.");
    return 2;
  }
  const client = new ConvexHttpClient(url);
  const count = { repaired: 0, unchanged: 0, collision: 0, "not-found": 0, requeued: 0, skipped: 0, failed: 0 };
  const n = await eachMessage(since, print, async (message, at, n) => {
    // The same decision and cleaning as the webhook; the captured mail is never stored here.
    let mail: ReceivedArgs["mail"] = null;
    let messageId = "";
    const r = await handleInbound(message, { token, allowlist, getMessage, received: async (a) => ((mail = a.mail), (messageId = a.messageId), { fresh: false }) }, at);
    if (r.status === "unreadable") {
      count.failed++;
      return print(`#${n} failed (AgentMail)`);
    }
    const kept = mail as ReceivedArgs["mail"];
    if (!kept || kept.tab !== "bandcamp") {
      count.skipped++;
      return print(`#${n} skipped (not a kept Bandcamp email)`);
    }
    // Exactly what the ingest worker does with a Bandcamp email: the template, then checkExtraction on the model's text.
    const text = `Subject: ${kept.subject}\n\n${kept.body}`.slice(0, MAX_EMAIL_CHARS);
    const x = checkExtraction(parseBandcampEmail(kept.subject, kept.body), text, at);
    if (!x.ok) {
      count.skipped++;
      return print(`#${n} skipped (template did not match)`);
    }
    const { artist, title, label } = x.release;
    let a: ReparseAnswer;
    try {
      a = await client.mutation(api.radar.reparse, { token, messageId, fields: { artist, title, ...(label && { label }) }, dryRun });
    } catch (e) {
      count.failed++;
      return print(`#${n} failed (Convex${codeOf(e)})`);
    }
    count[a.result]++;
    if (a.requeued) count.requeued++;
    print(`#${n} ${a.result}${a.requeued ? " requeued" : ""}`);
  });
  if (n === null) return 1;
  print(
    `${n} messages: ${count.repaired} repaired, ${count.unchanged} unchanged, ${count.collision} collision, ${count["not-found"]} not-found, ${count.requeued} requeued, ${count.skipped} skipped, ${count.failed} failed${dryRun ? " (dry run: nothing written)" : ""}`,
  );
  return count.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Values already in the environment win; then production's file, then the dev file (only its AGENTMAIL_API_KEY is used).
  for (const f of [".env.production.local", ".env.local"]) {
    try {
      process.loadEnvFile(new URL(`../${f}`, import.meta.url));
    } catch {
      // a missing file is fine: the values can come from the environment
    }
  }
  try {
    const opts = parseArgs(process.argv.slice(2));
    process.exitCode = await (opts.reparse ? reparse : backfill)(opts, console.log);
  } catch (e) {
    console.error(e instanceof Error ? e.message : "radar-backfill failed");
    process.exitCode = 2;
  }
}
