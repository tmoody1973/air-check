import { isPermanent, type PendingRun, type RelayConvex, type RunEvent, type Terminal } from "./convex.js";
import { HermesError, type HermesClient, type RunInfo } from "./hermes.js";

export interface Sandbox { name: string; workspace: "real" | "demo"; hermes: Pick<HermesClient, "start" | "stop" | "get" | "events"> }
export interface RunnerOptions {
  convex: RelayConvex;
  sandboxes: Sandbox[];
  log: (line: string) => void;
  /** Max time events wait before being sent to Convex (DELTA_FLUSH_MS). */
  flushMs?: number;
  backoffMs?: (attempt: number) => number;
  maxLive?: number;
}
export interface Runner { onPending(rows: PendingRun[]): void; stop(): void }

export const DELTA_FLUSH_MS = 500;
const TERMINAL_EVENTS: Record<string, Terminal> = {
  "run.completed": "completed", "run.failed": "failed", "run.cancelled": "cancelled", "run.interrupted": "failed",
};
const HERMES_DONE: Record<string, { event: string; status: Terminal }> = {
  completed: { event: "run.completed", status: "completed" },
  failed: { event: "run.failed", status: "failed" },
  cancelled: { event: "run.cancelled", status: "cancelled" },
  interrupted: { event: "run.interrupted", status: "failed" },
};
const defaultBackoff = (n: number) => Math.min(30_000, 1000 * 2 ** n);
/** Attempts per relay.* call before a transient error is treated as permanent. */
export const MAX_CALL_ATTEMPTS = 10;
/** A relay.* call gave up (permanent error, or MAX_CALL_ATTEMPTS transient ones): the run is dropped. */
class Dropped extends Error {}

export function createRunner(o: RunnerOptions): Runner {
  const flushMs = o.flushMs ?? DELTA_FLUSH_MS;
  const backoff = o.backoffMs ?? defaultBackoff;
  const maxLive = o.maxLive ?? 2;
  const byWorkspace = new Map(o.sandboxes.map((s) => [s.workspace, s]));
  const busy = new Map<string, string>(); // runId -> sandbox name, for runs this process is starting or streaming
  const stopSent = new Set<string>();
  const done = new Set<string>(); // finished by this process; pending rows lag behind Convex
  const failures = new Map<string, number>();
  const stopFailures = new Map<string, number>();
  let latest: PendingRun[] = [];
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const liveIn = (name: string) => [...busy.values()].filter((n) => n === name).length;

  function onPending(rows: PendingRun[]): void {
    latest = rows;
    for (const id of done) if (!rows.some((r) => r.runId === id)) done.delete(id);
    for (const r of rows) {
      const sb = byWorkspace.get(r.workspace);
      if (!sb || stopped || done.has(r.runId)) continue;
      if (r.stopRequested && r.hermesRunId && !stopSent.has(r.runId)) {
        stopSent.add(r.runId);
        sb.hermes.stop(r.hermesRunId).catch((err: unknown) => {
          if (err instanceof HermesError && err.status >= 400 && err.status < 500) return; // Hermes refused or lost it: nothing to retry
          const n = (stopFailures.get(r.runId) ?? 0) + 1;
          stopFailures.set(r.runId, n);
          stopSent.delete(r.runId);
          o.log(`run=${r.runId} event=stop_failed n=${n}`);
          scheduleRetry(backoff(n - 1));
        });
      }
      if (busy.has(r.runId)) continue;
      if (r.status === "queued") {
        if (liveIn(sb.name) >= maxLive || r.stopRequested) continue;
        busy.set(r.runId, sb.name);
        void begin(sb, r).finally(settle(r));
      } else if (r.hermesRunId && (r.status === "running" || r.status === "stopping")) {
        busy.set(r.runId, sb.name);
        void follow(sb, r, r.hermesRunId, true).finally(settle(r));
      }
    }
  }

  const settle = (r: PendingRun) => () => { busy.delete(r.runId); onPending(latest); };
  function scheduleRetry(ms: number) {
    if (retry || stopped) return;
    retry = setTimeout(() => { retry = undefined; onPending(latest); }, ms);
  }

  /** Calls Convex for one run, retrying transient errors with backoff. Throws Dropped when it gives up. */
  async function relayCall<T>(runId: string, name: string, fn: () => Promise<T>): Promise<T> {
    for (let n = 0; ; n++) {
      try { return await fn(); } catch (err) {
        if (stopped) throw err; // shutting down: leave the run for the next relay process
        if (isPermanent(err) || n + 1 >= MAX_CALL_ATTEMPTS) throw new Dropped();
        o.log(`run=${runId} event=${name}_retry n=${n + 1}`);
        await sleep(backoff(n));
      }
    }
  }

  /** Gives up on a run Convex will not accept: stop it in Hermes (best effort) and stop following it. */
  async function drop(sb: Sandbox, runId: string, hermesRunId: string): Promise<void> {
    done.add(runId);
    await sb.hermes.stop(hermesRunId).catch(() => o.log(`run=${runId} event=stop_failed n=1`));
    o.log(`run=${runId} event=dropped n=1`);
  }

  async function begin(sb: Sandbox, r: PendingRun): Promise<void> {
    let hermesRunId: string;
    try {
      // Idempotent by runId: a repeat start (after a crash between POST and `started`) returns the same Hermes run.
      hermesRunId = await sb.hermes.start(r.input, r.runId, r.kind === "chat" ? r.conversationId : undefined, r.instructions);
    } catch {
      o.log(`run=${r.runId} event=start_failed n=${failures.set(r.runId, (failures.get(r.runId) ?? 0) + 1).get(r.runId)}`);
      if (!stopped) await sleep(backoff((failures.get(r.runId) ?? 1) - 1));
      return;
    }
    let started: boolean;
    try {
      ({ started } = await relayCall(r.runId, "started", () => o.convex.started(r.runId, hermesRunId)));
    } catch (err) {
      if (err instanceof Dropped) await drop(sb, r.runId, hermesRunId); // Hermes is running it: stop it, nothing will record it
      return;
    }
    if (!started) { // cancelled while queued
      done.add(r.runId);
      await sb.hermes.stop(hermesRunId).catch(() => o.log(`run=${r.runId} event=stop_failed n=1`));
      o.log(`run=${r.runId} event=dropped n=1`);
      return;
    }
    o.log(`run=${r.runId} event=started n=1`);
    failures.delete(r.runId);
    await follow(sb, r, hermesRunId, false);
  }

  /**
   * Streams one Hermes run to Convex until it is terminal. Never throws: stream errors back off and retry,
   * a 404 from Hermes (GET or events) fails the run once, and a call Convex will not take drops the run.
   */
  async function follow(sb: Sandbox, r: PendingRun, hermesRunId: string, reconcileFirst: boolean): Promise<void> {
    let known = r.lastSeq ?? 0; // highest seq Convex may have applied
    let attempt = 0;
    let check = reconcileFirst;
    const synthetic = (event: string, data: Record<string, unknown>): RunEvent => ({ event, data, t: Date.now() / 1000, seq: known + 1 });
    while (!stopped) {
      try {
        if (check) {
          const info: RunInfo = await sb.hermes.get(hermesRunId);
          const fin = terminalOf(info);
          if (fin) return await finish(r.runId, synthetic(fin.event, info.output !== undefined ? { output: info.output } : {}), fin.status);
        }
        check = true; // any later pass follows a dropped stream
        const result = await stream(sb, r.runId, hermesRunId, (seq) => { known = Math.max(known, seq); });
        if (result) return await finish(r.runId, undefined, result);
        attempt = 0;
      } catch (err) {
        try {
          if (err instanceof Dropped) return await drop(sb, r.runId, hermesRunId);
          // Hermes lost the run (GET or events 404): fail it once, no more retries.
          if (err instanceof HermesError && err.status === 404) return await finish(r.runId, synthetic("run.failed", {}), "failed");
        } catch (inner) {
          if (inner instanceof Dropped) return await drop(sb, r.runId, hermesRunId);
          return; // the relay is stopping
        }
        o.log(`run=${r.runId} event=stream_error n=${attempt + 1}`);
      }
      await sleep(backoff(attempt++));
    }
  }

  function terminalOf(info: RunInfo) {
    return HERMES_DONE[info.status];
  }

  /** One pass over the events stream. Resolves with the terminal status, or undefined if the stream ended without one. */
  async function stream(sb: Sandbox, runId: string, hermesRunId: string, sawSeq: (n: number) => void): Promise<Terminal | undefined> {
    let seq = 0; // renumbered from 1 on every open; Convex skips seq <= lastSeq
    let buffer: RunEvent[] = [];
    let timer: NodeJS.Timeout | undefined;
    let chain: Promise<void> = Promise.resolve();
    let lost: unknown; // a batch failed for good: stop reading
    const flush = () => {
      if (timer) { clearTimeout(timer); timer = undefined; }
      const batch = buffer;
      buffer = [];
      if (batch.length === 0) return chain;
      chain = chain.then(async () => {
        // Retry transient failures with backoff; a permanent one (or the 10th) drops the run.
        await relayCall(runId, "events", () => o.convex.events(runId, batch));
        sawSeq(batch[batch.length - 1]!.seq);
        for (const [event, n] of count(batch)) o.log(`run=${runId} event=${event} n=${n}`);
      });
      chain.catch((err: unknown) => { lost ??= err; }); // observe only: later batches must not land after a lost one
      return chain;
    };
    try {
      for await (const e of sb.hermes.events(hermesRunId)) {
        if (lost) throw lost;
        buffer.push({ event: e.event, data: e.data, t: Date.now() / 1000, seq: ++seq });
        const terminal = TERMINAL_EVENTS[e.event];
        if (terminal) { await flush(); return terminal; }
        timer ??= setTimeout(() => void flush().catch(() => {}), flushMs);
      }
      await flush();
      return undefined;
    } catch (err) {
      if (timer) clearTimeout(timer);
      await chain.catch(() => {});
      throw err;
    }
  }

  async function finish(runId: string, synthetic: RunEvent | undefined, status: Terminal): Promise<void> {
    if (synthetic) {
      await relayCall(runId, "events", () => o.convex.events(runId, [synthetic]));
      o.log(`run=${runId} event=${synthetic.event} n=1`);
    }
    await relayCall(runId, "finished", () => o.convex.finished(runId, status));
    done.add(runId);
    o.log(`run=${runId} event=finished n=1 status=${status}`);
  }

  return { onPending, stop() { stopped = true; if (retry) clearTimeout(retry); } };
}

function count(batch: RunEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of batch) m.set(e.event, (m.get(e.event) ?? 0) + 1);
  return m;
}
