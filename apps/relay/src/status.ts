import { parseSandboxStatus } from "@aircheck/core";
import { execFile } from "node:child_process";
import type { RelayConvex } from "./convex.js";

export type ExecText = (bin: string, args: string[], timeoutMs: number) => Promise<string>;

export const execText: ExecText = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

export interface StatusOptions {
  sandboxes: { name: string; workspace: "real" | "demo" }[];
  bin: string; convex: RelayConvex; log: (line: string) => void;
  exec?: ExecText; everyMs?: number;
}

const TIMEOUT_MS = 30_000;

/** Once at start, then every 5 minutes: `<bin> <name> status` + `policy get` -> parse -> relay.status. Never throws; never logs raw output. */
export function pollStatus(o: StatusOptions): { stop(): void; ready: Promise<void> } {
  const exec = o.exec ?? execText;
  const once = async (s: StatusOptions["sandboxes"][number]) => {
    try {
      const [statusText, policyText] = await Promise.all([exec(o.bin, [s.name, "status"], TIMEOUT_MS), exec(o.bin, [s.name, "policy", "get"], TIMEOUT_MS)]);
      const { phase, allowedHosts } = parseSandboxStatus(statusText, policyText);
      await o.convex.status(s.workspace, phase, allowedHosts);
      o.log(`status sandbox=${s.name} phase=${phase ?? "unknown"} hosts=${allowedHosts}`);
    } catch {
      o.log(`status sandbox=${s.name} ok=false`);
    }
  };
  let inFlight = false; // a slow nemohermes must not stack polls
  const all = async () => {
    if (inFlight) return;
    inFlight = true;
    try { await Promise.all(o.sandboxes.map(once)); } finally { inFlight = false; }
  };
  const ready = all();
  const timer = setInterval(() => void all(), o.everyMs ?? 5 * 60_000);
  return { stop: () => clearInterval(timer), ready };
}
