"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import { ClaimReport } from "@/components/ClaimReport";
import { DeepDiveCard } from "@/components/DeepDiveCard";
import { ResearchProgress } from "@/components/ResearchProgress";
import { type BlockActions, ExportBar, ShowNotesCard } from "@/components/ShowNotesCard";
import { Shell } from "@/components/Shell";
import { useChicagoDayKey } from "@/lib/date";
import { exportFileName, pageTitle } from "@/lib/research";

// Plan 7: one research job. Every row comes from Convex; every button is a mutation run as the signed-in person.
export default function ResearchPage() {
  const { id } = useParams<{ id: string }>();
  const today = useChicagoDayKey();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const view = useQuery(api.research.get, { jobId: id, today });
  const markdown = useQuery(api.research.exportMarkdown, { jobId: id });
  const takeOver = useMutation(api.research.takeOver);
  const resume = useMutation(api.research.resume);
  const regenerate = useMutation(api.research.regenerate);
  const editEntry = useMutation(api.research.editEntry);
  const setPrivate = useMutation(api.research.setPrivate);
  const setSuppliedNote = useMutation(api.research.setSuppliedNote);

  if (view === undefined) return <Shell title="Research"><p className="text-ink-soft">Loading…</p></Shell>;
  if (view === null) return <Shell title="Research"><p className="text-ink-soft">Research not found</p></Shell>;

  const actions: BlockActions = {
    edit: (key, text) => editEntry({ jobId: id, key, text }),
    setPrivate: (key, isPrivate) => setPrivate({ jobId: id, key, private: isPrivate }),
    setNote: (key, note) => setSuppliedNote({ jobId: id, key, note }),
    regenerate: (key, overwriteEdit) => regenerate({ jobId: id, key, overwriteEdit }),
  };
  const problems = view.job.lastProblems ?? [];
  const kind = view.job.kind;

  return (
    <Shell title={pageTitle(view)}>
      <div className="flex max-w-3xl min-w-0 flex-col gap-5">
        <ResearchProgress
          view={view} authReady={!isLoading && isAuthenticated}
          onTakeOver={() => takeOver({ jobId: id })} onResume={() => resume({ jobId: id })}
        />
        {problems.length > 0 && (
          <section aria-labelledby="refused-h" className="rounded-card border border-line bg-surface px-5 py-4">
            <h2 id="refused-h" className="text-sm font-semibold">The agent&apos;s last refused saves</h2>
            <p className="mt-1 text-[12.5px] text-muted">Air Check turned these down and kept what was already saved.</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
              {problems.map((p, i) => <li key={i} className="[overflow-wrap:anywhere]">{p}</li>)}
            </ul>
          </section>
        )}
        <ExportBar markdown={markdown} fileName={exportFileName(view)} />
        {kind === "show-notes" && <ShowNotesCard view={view} today={today} actions={actions} />}
        {kind === "verify" && <ClaimReport view={view} today={today} actions={actions} />}
        {kind === "deep-dive" && <DeepDiveCard view={view} today={today} actions={actions} />}
      </div>
    </Shell>
  );
}
