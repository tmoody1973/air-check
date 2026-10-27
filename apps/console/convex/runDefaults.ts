import type { RunState } from "@aircheck/core";
import type { Doc } from "./_generated/dataModel";

type RunStatus = NonNullable<Doc<"runs">["status"]>;

/** Plan-3-era rows have no status: fall back to the reducer state ("interrupted" counts as failed). */
export function statusOf(run: Doc<"runs">): RunStatus | undefined {
  if (run.status) return run.status;
  const s = (run.state as Partial<RunState> | undefined)?.status;
  if (s === "interrupted") return "failed";
  return s;
}

/** Rows without a source predate live runs: live only in the real workspace, otherwise a scripted sample. */
export const sourceOf = (run: Doc<"runs">): "live" | "scripted" => run.source ?? (run.workspace === "real" ? "live" : "scripted");

export const createdAtOf = (run: Doc<"runs">): number => run.createdAt ?? run._creationTime;

export const isTerminal = (status: RunStatus | undefined): boolean => status === "completed" || status === "cancelled" || status === "failed";
