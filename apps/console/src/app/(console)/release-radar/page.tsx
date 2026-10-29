"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { RadarView } from "@/components/RadarView";
import type { RadarActions, RadarTab } from "@/components/ReleaseItem";
import { Shell, useWorkspace } from "@/components/Shell";
import { useChicagoDayKey } from "@/lib/date";

// Plan 8 Task 6: the Release radar. The tab is kept in the URL (?tab=cosign) so Today's co-sign line and a reload land
// on it. Each action is a Convex mutation run as the signed-in person; Convex refuses anyone else in plain words.

function RadarBody() {
  const router = useRouter();
  const tab: RadarTab = useSearchParams().get("tab") === "cosign" ? "cosign" : "bandcamp";
  const workspace = useWorkspace();
  const today = useChicagoDayKey();
  // Both tabs: each tab label shows its count of new records.
  const bandcamp = useQuery(api.radar.list, { tab: "bandcamp" });
  const cosign = useQuery(api.radar.list, { tab: "cosign" });
  // [] for anyone but a real human, so the demo never shows the list.
  const notAdded = useQuery(api.radar.notAdded, {});
  const setStatus = useMutation(api.radar.setStatus);
  const edit = useMutation(api.radar.edit);
  const setEmbargo = useMutation(api.radar.setEmbargo);
  const retry = useMutation(api.radar.retry);
  const retryEmbed = useMutation(api.radar.retryEmbed);
  const id = (releaseId: string) => releaseId as Id<"releases">;
  const actions: RadarActions = {
    setStatus: (a) => setStatus({ ...a, releaseId: id(a.releaseId) }),
    edit: (a) => edit({ ...a, releaseId: id(a.releaseId) }),
    setEmbargo: (a) => setEmbargo({ ...a, releaseId: id(a.releaseId) }),
    retry,
    retryEmbed: (a) => retryEmbed({ releaseId: id(a.releaseId) }),
  };
  return (
    <RadarView
      lists={{ bandcamp, cosign }}
      tab={tab}
      onTabChange={(t) => router.replace(t === "cosign" ? "/release-radar?tab=cosign" : "/release-radar")}
      workspace={workspace}
      today={today}
      actions={actions}
      notAdded={notAdded}
    />
  );
}

export default function ReleaseRadarPage() {
  return (
    <Shell title="Release radar">
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <RadarBody />
      </Suspense>
    </Shell>
  );
}
