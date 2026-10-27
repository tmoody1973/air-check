"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { Shell } from "@/components/Shell";
import { TracklistEditor } from "@/components/TracklistEditor";

function Editor() {
  const router = useRouter();
  const from = useSearchParams().get("from");
  const run = useQuery(api.runs.get, from ? { runId: from } : "skip");
  const draft = useMutation(api.tracklist.draft);

  if (from && run === undefined) return <p className="text-ink-soft">Loading…</p>;
  const initial = run?.form ?? undefined;
  return (
    <TracklistEditor
      key={from ?? "new"}
      draft={(form) => draft(form)}
      onDone={(runId) => router.push(`/runs/${runId}`)}
      initial={initial}
      loadFailed={Boolean(from) && !initial}
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
