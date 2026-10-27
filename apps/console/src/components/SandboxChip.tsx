import { Pill } from "./Pill";

export const STALE_MS = 15 * 60_000;

interface Row { phase: string | null; allowedHosts: number; at: number }

/** "Sandbox on" only when the relay says Ready and said it within 15 minutes; otherwise "unknown" (never a guess). */
export function SandboxChip({ row, now }: { row: Row | null | undefined; now: number }) {
  const on = row?.phase === "Ready" && now - row.at <= STALE_MS;
  return (
    <Pill tone="neutral">
      {on ? <span aria-hidden="true" className="size-2 rounded-full bg-signal" /> : null}
      {on ? `Sandbox on · ${row.allowedHosts} ${row.allowedHosts === 1 ? "host" : "hosts"} allowed` : "Sandbox status unknown"}
    </Pill>
  );
}
