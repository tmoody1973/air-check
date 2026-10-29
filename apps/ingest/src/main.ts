import { boxClient } from "./box.js";
import { loadConfig } from "./config.js";
import { connectConvex } from "./convex.js";
import { draftPass } from "./draft.js";
import { driveClient } from "./drive.js";
import { dropboxClient } from "./dropbox.js";
import { fetchPass } from "./fetch.js";
import { realHttp } from "./http.js";
import { newMemory, runScan, type ScanDeps } from "./scan.js";

// Hard Rule 8: journald (stdout) only, and only `ingest date=... step=... ok=... ms=...` lines: dates, steps, counts,
// codes and timings. Never a file or doc name, notes text, a token or a URL.
const log = (line: string) => console.log(line);

/** Runs `fn` every `ms`, never two at once. A failed pass is logged and the next one runs. */
function every(ms: number, step: string, fn: () => Promise<void>): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await fn(); } catch { log(`ingest step=${step} ok=false`); } finally { running = false; }
  };
  void tick();
  return setInterval(() => void tick(), ms);
}

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    console.error(`aircheck-ingest: ${e instanceof Error ? e.message : "bad config"}`);
    process.exit(1);
  }
  const { box, google, dropbox } = config;
  const convex = connectConvex(config.convexUrl, config.ingestToken);
  const boxSide = box ? { client: boxClient(realHttp, box), folderId: box.folderId } : null;
  const scanDeps: ScanDeps = {
    convex, log, memory: newMemory(), tokenDir: config.tokenDir, inboxDir: config.inboxDir, preparedDir: config.preparedDir,
    box: boxSide,
    google: google ? (rt) => driveClient(realHttp, google, rt) : null,
    dropbox: dropbox ? (rt) => dropboxClient(realHttp, dropbox, rt) : null,
  };
  const fetchDeps = { convex, log, box: boxSide?.client ?? null, inboxDir: config.inboxDir, preparedDir: config.preparedDir, failures: new Map<string, { count: number; at: number }>() };
  const draftDeps = { convex, log, last: { key: "" }, scan: scanDeps.memory };
  log("ingest step=start ok=true");
  const timers = [
    every(config.scanMs, "scan", () => runScan(scanDeps)),
    // One download at a time; then at most one draft request.
    every(config.pollMs, "pass", async () => {
      await fetchPass(fetchDeps);
      await draftPass(draftDeps);
    }),
  ];
  // Stopping mid-download leaves an .ingest-part; the next pass removes it and downloads again.
  const shutdown = () => { for (const t of timers) clearInterval(t); process.exit(0); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

process.on("unhandledRejection", () => console.log("ingest step=unhandled_rejection ok=false"));
main();
