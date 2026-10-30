"use client";

import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { Shell } from "@/components/Shell";
import { TracklistEditor } from "@/components/TracklistEditor";

function Editor() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const from = useSearchParams().get("from");
  const run = useQuery(api.runs.get, from ? { runId: from } : "skip");
  const draft = useMutation(api.tracklist.draft);
  const startShowNotes = useMutation(api.research.startShowNotes);
  const convex = useConvex();

  if (from && run === undefined) return <p className="text-ink-soft">Loading…</p>;
  const initial = run?.form ?? undefined;
  return (
    <TracklistEditor
      key={from ?? "new"}
      draft={(form) => draft(form)}
      onDone={(runId) => router.push(`/runs/${runId}`)}
      initial={initial}
      loadFailed={Boolean(from) && !initial}
      authReady={!isLoading && isAuthenticated}
      writeNotes={(f) => startShowNotes({ ...f, angles: true })}
      onNotes={(jobId) => router.push(`/research/${jobId}`)}
      // Read once on click, not subscribed: a later save must not replace what Tarik is typing.
      loadNotes={(showDate) => convex.query(api.research.notesForDraft, { showDate })}
    />
  );
}

export default function TracklistPage() {
  return (
    <Shell title="Tracklist">
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Editor />
      </Suspense>
    </Shell>
  );
}
