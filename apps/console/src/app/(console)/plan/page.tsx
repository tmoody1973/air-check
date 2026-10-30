"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { DeepDiveForm, ResearchList, type ResearchRow } from "@/components/PlanView";
import { SampleTag } from "@/components/SampleTag";
import { Shell, useWorkspace } from "@/components/Shell";

// Theme ideas (design spec 6.2) join this page later, beside the deep dive.
export default function PlanPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const start = useMutation(api.research.startDeepDive);
  const rows = useQuery(api.research.list, {}) as ResearchRow[] | undefined;
  return (
    <Shell title="Plan">
      <div className="flex max-w-3xl min-w-0 flex-col gap-5">
        {workspace === "demo" && (
          <p className="flex items-center gap-3 text-sm text-ink-soft">
            <SampleTag /> The sample reports use placeholders, not real releases.
          </p>
        )}
        <DeepDiveForm start={start} onStarted={(jobId) => router.push(`/research/${jobId}`)} authReady={!isLoading && isAuthenticated} />
        <ResearchList rows={rows} />
      </div>
    </Shell>
  );
}
