import { loadConfig } from "./config.js";
import { connectConvex } from "./convex.js";
import { realExec } from "./encode.js";
import { runPass } from "./inbox.js";

// Hard Rule 8: journald (stdout) only, and only `media date=... package=... step=... ok=... ms=...` lines.
const log = (line: string) => console.log(line);

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    console.error(`aircheck-media: ${e instanceof Error ? e.message : "bad config"}`);
    process.exit(1);
  }
  const deps = { convex: connectConvex(config.convexUrl, config.mediaToken), exec: realExec, log, inboxDir: config.inboxDir, preparedDir: config.preparedDir, maxPrepared: config.maxPrepared, failedAt: new Map<string, number>() };
  let running = false; // one pass (so one encode) at a time
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runPass(deps); } catch { log("media step=pass ok=false"); } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), config.pollMs);
  const shutdown = () => { clearInterval(timer); process.exit(0); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

process.on("unhandledRejection", () => console.log("media step=unhandled_rejection ok=false"));
main();
