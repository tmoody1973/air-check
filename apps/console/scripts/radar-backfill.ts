// One-off catch-up for ruling R12 (the sender-check hotfix). Lists the radar inbox's messages since a date, oldest
// first, and runs each through the same handleInbound as the webhook, so mail refused by the old check (or never
// delivered while the webhook was paused) is stored now. Safe to run twice: radar.received keeps one row per message id
// (an "ignored" row gives way to a kept one). Prints codes and counts only: never a subject, sender, body or secret.
//
//   pnpm --filter console exec tsx scripts/radar-backfill.ts --since 2026-10-27 [--dry-run]
//
// Reads AGENTMAIL_API_KEY, INBOX_TOKEN, RADAR_SENDERS and CONVEX_URL (the production Convex URL, never the dev one in
// .env.local) from the environment, then from apps/console/.env.production.local and .env.local. See docs/DEPLOY.md.

import { pathToFileURL } from "node:url";
import { parseAllowlist } from "@aircheck/core";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { AgentMailError, getMessage, listMessages } from "../src/lib/agentmail";
import { handleInbound, type InboundResult, type ReceivedArgs } from "../src/lib/radarInbound";

const MAX_PAGES = 1_000; // ponytail: a page token that never ends stops here; 100,000 messages is far past this inbox

export type BackfillOptions = { since: Date; dryRun: boolean };

export function parseArgs(argv: string[]): BackfillOptions {
  let since: Date | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--since" && argv[i + 1] && /^\d{4}-\d{2}-\d{2}/.test(argv[i + 1]!)) since = new Date(argv[++i]!);
    else throw new Error(`Unexpected argument: ${argv[i]}. Usage: radar-backfill.ts --since YYYY-MM-DD [--dry-run]`);
  }
  if (!since || !Number.isFinite(since.getTime())) throw new Error("--since YYYY-MM-DD is required");
  return { since, dryRun };
}

const line = (n: number, r: InboundResult, dryRun: boolean): string => {
  switch (r.status) {
    case "skipped":
      return `#${n} skipped (no message id or sender)`;
    case "unreadable":
      return `#${n} failed (AgentMail)`;
    case "unstored":
      return `#${n} failed (Convex)`;
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
  let n = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let messages: unknown[];
    try {
      ({ messages, nextPageToken: pageToken } = await listMessages(since, pageToken));
    } catch (e) {
      print(`Listing the inbox failed: ${e instanceof AgentMailError ? e.message : "no answer"}`);
      return 1;
    }
    for (const message of messages) {
      const at = Date.parse(String((message as { timestamp?: unknown } | null)?.timestamp ?? ""));
      const r = await handleInbound(message, { token, allowlist, getMessage, received }, Number.isFinite(at) ? at : Date.now());
      print(line(++n, r, dryRun));
      if (r.status === "stored") count[r.kept ? "kept" : "ignored"]++;
      else count[r.status === "skipped" ? "skipped" : "failed"]++;
    }
    if (!pageToken) break;
  }
  print(`${n} messages: ${count.kept} kept, ${count.ignored} ignored, ${count.skipped} skipped, ${count.failed} failed${dryRun ? " (dry run: nothing written)" : ""}`);
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
    process.exitCode = await backfill(parseArgs(process.argv.slice(2)), console.log);
  } catch (e) {
    console.error(e instanceof Error ? e.message : "radar-backfill failed");
    process.exitCode = 2;
  }
}
