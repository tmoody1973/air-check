import { parseAuditLine, type AuditEvent } from "@aircheck/core";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { RelayConvex } from "./convex.js";

export interface LogChild { stdout: Readable; onExit(cb: () => void): void; kill(): void }
export type SpawnLogs = (bin: string, args: string[]) => LogChild;

export interface AuditOptions {
  name: string; workspace: "real" | "demo"; bin: string;
  convex: RelayConvex; spawn: SpawnLogs; log: (line: string) => void;
  flushMs?: number; backoffMs?: (attempt: number) => number;
}

const MAX_BUFFERED = 500; // also the most events per relay.activity call

/** Follows `nemohermes <name> logs --follow`, restarting it with backoff, and sends parsed network decisions to Convex. */
export function followAudit(o: AuditOptions): { stop(): void } {
  const flushMs = o.flushMs ?? 2000;
  const backoff = o.backoffMs ?? ((n: number) => Math.min(30_000, 1000 * 2 ** n));
  let buffer: AuditEvent[] = [];
  let parsed = 0, skipped = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: LogChild | undefined;

  const flush = async () => {
    timer = undefined;
    const batch = buffer;
    buffer = [];
    if (batch.length === 0 && skipped === 0) return;
    o.log(`audit sandbox=${o.name} parsed=${parsed} skipped=${skipped}`);
    parsed = 0; skipped = 0;
    if (batch.length === 0) return;
    for (let i = 0; i < batch.length; i += MAX_BUFFERED) {
      const chunk = batch.slice(i, i + MAX_BUFFERED);
      try {
        await o.convex.activity(o.workspace, chunk);
      } catch {
        o.log(`audit sandbox=${o.name} activity_failed n=${batch.length - i}`);
        buffer = [...batch.slice(i), ...buffer]; // keep the rest for the next flush
        if (!stopped) timer ??= setTimeout(() => void flush(), flushMs);
        return;
      }
    }
  };

  const run = async () => {
    for (let attempt = 0; !stopped; attempt++) {
      let child: LogChild | undefined;
      try {
        child = current = o.spawn(o.bin, [o.name, "logs", "--follow"]);
        const exited = new Promise<void>((r) => child!.onExit(r));
        for await (const line of createInterface({ input: child.stdout })) {
          attempt = 0;
          const event = line.trim() ? parseAuditLine(line) : undefined;
          if (event) { buffer.push(event); parsed++; } else if (line.trim()) skipped++;
          timer ??= setTimeout(() => void flush(), flushMs);
        }
        await exited;
      } catch {
        o.log(`audit sandbox=${o.name} follower_error`);
      }
      if (stopped) break;
      o.log(`audit sandbox=${o.name} follower_exited restart`);
      await new Promise((r) => setTimeout(r, backoff(attempt)));
    }
  };
  void run();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      current?.kill();
      void flush();
    },
  };
}
