"use client";

import { useMutation, useQuery } from "convex/react";
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
  const today = useChicagoDayKey();
  return (
    <Shell title="Episodes">
      <EpisodesView data={data} sources={sources} workspace={workspace} today={today} actions={{ answer, markRerun, unmarkRerun }} />
    </Shell>
  );
}
