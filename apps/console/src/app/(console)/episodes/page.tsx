"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import type { Posted } from "@/components/AddShowDate";
import { EpisodesView } from "@/components/EpisodesView";
import { Shell, useWorkspace } from "@/components/Shell";
import { useChicagoDayKey } from "@/lib/date";

/** The console's own route (signed-in session cookie); null when it or Mixcloud couldn't answer. */
async function postedShows(): Promise<Posted[] | null> {
  const res = await fetch("/api/mixcloud/posted?year=2025", { cache: "no-store" });
  return res.ok ? ((await res.json()) as Posted[]) : null;
}

export default function EpisodesPage() {
  const workspace = useWorkspace();
  const data = useQuery(api.episodes.list, {});
  const sources = useQuery(api.episodes.sources, {});
  const answer = useMutation(api.episodes.answer);
  const markRerun = useMutation(api.episodes.markRerun);
  const unmarkRerun = useMutation(api.episodes.unmarkRerun);
  const retryDraft = useMutation(api.episodes.retryDraft);
  // Plan 6b: fixes saved in Air Check (decision 017). Each runs as the signed-in person; Convex refuses anyone else.
  const unplaced = useQuery(api.episodes.unplaced, {});
  const setTracklist = useMutation(api.corrections.setTracklist);
  const pick = useMutation(api.corrections.pick);
  const setHours = useMutation(api.corrections.setHours);
  const folderDate = useMutation(api.corrections.useFolderDate);
  const clearCorrection = useMutation(api.corrections.clear);
  const place = useMutation(api.corrections.place);
  const unplace = useMutation(api.corrections.unplace);
  // Add a 2025 show: only the 2025 Fridays added here join the backlog.
  const added = useQuery(api.episodes.extraDates, {});
  const addShowDate = useMutation(api.episodes.addShowDate);
  const removeShowDate = useMutation(api.episodes.removeShowDate);
  const convex = useConvex();
  // Read once when the editor opens, not subscribed: a rescan must not replace what Tarik is typing.
  const tracklistText = async (showDate: string) => (await convex.query(api.corrections.tracklistText, { showDate }))?.text ?? "";
  const today = useChicagoDayKey();
  // Plan 7: research from a show's own tracklist or Paper notes, then its page.
  const router = useRouter();
  const startShowNotes = useMutation(api.research.startShowNotes);
  const startVerify = useMutation(api.research.startVerify);
  const research = {
    startShowNotes: ({ showDate }: { showDate: string }) => startShowNotes({ showDate, angles: true }),
    startVerify: ({ showDate }: { showDate: string }) => startVerify({ showDate, notes: { from: "paper" as const } }),
    openResearch: (jobId: string) => router.push(`/research/${jobId}`),
  };
  // Oct 30: Draft now skips the queue for one show; its live run page opens (Watch it work, Take over).
  const draftNowMutation = useMutation(api.draftNow.draftNow);
  const drafting = {
    draftNow: ({ showDate }: { showDate: string }) => draftNowMutation({ showDate }),
    openRun: (runId: string) => router.push(`/runs/${runId}`),
  };
  return (
    <Shell title="Episodes">
      <EpisodesView
        data={data}
        unplaced={unplaced}
        sources={sources}
        workspace={workspace}
        today={today}
        actions={{ answer, markRerun, unmarkRerun, retryDraft, setTracklist, pick, setHours, useFolderDate: folderDate, clearCorrection, place, unplace, tracklistText, ...research, ...drafting }}
        added={added}
        addActions={{ addShowDate, removeShowDate, postedShows }}
      />
    </Shell>
  );
}
