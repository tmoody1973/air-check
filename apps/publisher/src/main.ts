import { guardArgs } from "./cli.js";
import { loadConfig } from "./config.js";
import { connectConvex } from "./convex.js";
import { fullPass, startup, statusReporter, unlistedTest, type PublishDeps } from "./publish.js";
import { openState } from "./state.js";
import { sendReadyCards, telegramSender } from "./telegram.js";

// Hard Rule 8: journald (stdout) only, and only `publish package=... step=... ok=... ms=...` lines (with `update=...`
// first for a description update) plus the start line.
const log = (line: string) => console.log(line);
const CARDS_MS = 60_000;

/** Runs `fn` every `ms`, never two at once (one upload at a time). A failed pass is logged and the next one runs. */
function every(ms: number, step: string, fn: () => Promise<void>): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await fn(); } catch { log(`publish package=- step=${step} ok=false ms=0`); } finally { running = false; }
  };
  void tick();
  return setInterval(() => void tick(), ms);
}

async function main(): Promise<void> {
  // I1: a mistyped flag must never fall through to the public service.
  const mode = guardArgs(process.argv.slice(2), { err: (l) => console.error(l), exit: (code) => process.exit(code) });
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    console.error(`aircheck-publisher: ${e instanceof Error ? e.message : "bad config"}`);
    process.exit(1);
  }
  const convex = connectConvex(config.convexUrl, config.publisherToken);
  if (mode.kind === "unlisted") {
    // R8: by hand over ssh, with the service stopped. Prints only the show's URL or an error code.
    const out = await unlistedTest({ convex, log: () => {}, tokenFile: config.tokenFile, preparedDir: config.preparedDir }, mode.packageId);
    console.log(out);
    process.exit(out.startsWith("https://") ? 0 : 1);
  }

  const state = await openState(config.stateFile);
  const send = telegramSender(config.secretsFile);
  const deps: PublishDeps = {
    convex, log, tokenFile: config.tokenFile, preparedDir: config.preparedDir, state, report: statusReporter(convex), alert: send,
  };
  log("aircheck-publisher started");
  // R12: reconcile exactly once, before the loop. If Convex is unreachable, exit and let systemd restart us.
  await startup(deps);
  const timers = [
    // One upload and one description update at most per pass, never two requests at once.
    every(config.pollMs, "pass", () => fullPass(deps)),
    every(CARDS_MS, "cards", () => sendReadyCards({ convex, state, appUrl: config.appUrl, send, log })),
  ];
  // Stopping mid-upload leaves the package `publishing`; the next start reconciles it to outcome_unknown.
  const shutdown = () => { for (const t of timers) clearInterval(t); process.exit(0); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

process.on("unhandledRejection", () => console.log("publish package=- step=unhandled_rejection ok=false ms=0"));
main().catch(() => {
  console.error("aircheck-publisher: startup failed");
  process.exit(1);
});
