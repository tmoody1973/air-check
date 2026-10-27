"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import type { RunState } from "@aircheck/core";
import { api } from "../../../../../convex/_generated/api";
import { RunProgressCard } from "@/components/RunProgressCard";
import { Shell, useWorkspace } from "@/components/Shell";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const workspace = useWorkspace();
  const run = useQuery(api.runs.get, { runId: id });
  const requestStop = useMutation(api.runs.requestStop);

  if (run === undefined) return <Shell title="Run"><p className="text-ink-soft">Loading…</p></Shell>;
  if (run === null) return <Shell title="Run"><p className="text-ink-soft">Run not found</p></Shell>;

  const state = run.state as RunState;
  // Seeded Plan 3 runs predate these fields.
  const status = run.status ?? (state.status === "interrupted" ? "failed" : state.status);
  const source = run.source ?? (workspace === "demo" ? "scripted" : "live");
  const upcoming = run.upcoming ?? [];
  // Totals are counted here from stored rows, never by the model. Plan 4 can store the real totals on the run.
  const totals = { tracks: state.steps.length + upcoming.length, closingSkipped: upcoming.filter((u) => u.status === "skipped").length };

  return (
    <Shell title="Live progress">
      <div className="max-w-2xl">
        <RunProgressCard
          title={run.title} state={state} totals={totals} upcoming={upcoming}
          status={status} source={source} runId={run.runId} kind={run.kind} packageId={run.packageId}
          onTakeOver={() => requestStop({ runId: run.runId })}
        />
      </div>
    </Shell>
  );
}
