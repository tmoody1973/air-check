import type { ReactNode } from "react";

export type PillTone = "ready" | "caution" | "problem" | "neutral";

const TONE: Record<PillTone, string> = {
  ready: "bg-signal-soft text-signal",
  caution: "bg-caution-bg text-caution-text",
  problem: "bg-problem-bg text-problem-text",
  neutral: "bg-chip text-ink-soft",
};

// A status is always a word plus a color, never color alone.
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}
