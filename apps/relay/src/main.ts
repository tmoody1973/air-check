import { spawn } from "node:child_process";
import { followAudit, type SpawnLogs } from "./audit.js";
import { bridgePrefetch } from "./bridge.js";
import { loadConfig } from "./config.js";
import { connectConvex } from "./convex.js";
import { HermesClient } from "./hermes.js";
import { createRunner } from "./runner.js";
import { pollStatus } from "./status.js";

// Hard Rule 8: journald (stdout) only. Lines carry ids and counts, never input, replies, tool arguments or tokens.
const log = (line: string) => console.log(line);

const spawnLogs: SpawnLogs = (bin, args) => {
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
  return { stdout: child.stdout, onExit: (cb) => { child.once("close", cb); child.once("error", cb); }, kill: () => void child.kill() };
};

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    console.error(`aircheck-relay: ${e instanceof Error ? e.message : "bad config"}`);
    process.exit(1);
  }
  const convex = connectConvex(config.convexUrl, config.relayToken);
  const runner = createRunner({
    convex, log,
    ...(config.bridge && { prefetch: bridgePrefetch(config.bridge) }),
    sandboxes: config.sandboxes.map((s) => ({ name: s.name, workspace: s.workspace, hermes: new HermesClient(`http://127.0.0.1:${s.port}`, s.token) })),
  });
  const unsubscribe = convex.subscribePending(runner.onPending, () => log("pending subscription_error"));
  const followers = config.sandboxes.map((s) => followAudit({ name: s.name, workspace: s.workspace, bin: config.nemohermesBin, convex, spawn: spawnLogs, log }));
  const status = pollStatus({ sandboxes: config.sandboxes, bin: config.nemohermesBin, convex, log });
  log(`relay started sandboxes=${config.sandboxes.map((s) => s.name).join(",") || "none"}`);
  const shutdown = () => { unsubscribe(); runner.stop(); followers.forEach((f) => f.stop()); status.stop(); void convex.close().finally(() => process.exit(0)); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

process.on("unhandledRejection", () => log("unhandled_rejection")); // never crash on a stray rejection; reason may hold text, so not logged
main();
