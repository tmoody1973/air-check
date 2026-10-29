"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { EpisodesView } from "@/components/EpisodesView";
import { Shell, useWorkspace } from "@/components/Shell";
import { useChicagoDayKey } from "@/lib/date";

export default function EpisodesPage() {
  const workspace = useWorkspace();
  const data = useQuery(api.episodes.list, {});
  const sources = useQuery(api.episodes.sources, {});
  const answer = useMutation(api.episodes.answer);
  const markRerun = useMutation(api.episodes.markRerun);
  const unmarkRerun = useMutation(api.episodes.unmarkRerun);
  // Plan 6b: fixes saved in Air Check (decision 017). Each runs as the signed-in person; Convex refuses anyone else.
  const unplaced = useQuery(api.episodes.unplaced, {});
  const setTracklist = useMutation(api.corrections.setTracklist);
  const pick = useMutation(api.corrections.pick);
  const setHours = useMutation(api.corrections.setHours);
  const folderDate = useMutation(api.corrections.useFolderDate);
  const clearCorrection = useMutation(api.corrections.clear);
  const place = useMutation(api.corrections.place);
  const unplace = useMutation(api.corrections.unplace);
  const convex = useConvex();
  // Read once when the editor opens, not subscribed: a rescan must not replace what Tarik is typing.
  const tracklistText = async (showDate: string) => (await convex.query(api.corrections.tracklistText, { showDate }))?.text ?? "";
  const today = useChicagoDayKey();
  return (
    <Shell title="Episodes">
      <EpisodesView
        data={data}
        unplaced={unplaced}
        sources={sources}
        workspace={workspace}
        today={today}
        actions={{ answer, markRerun, unmarkRerun, setTracklist, pick, setHours, useFolderDate: folderDate, clearCorrection, place, unplace, tracklistText }}
      />
    </Shell>
  );
}
