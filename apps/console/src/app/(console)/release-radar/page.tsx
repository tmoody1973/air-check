"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { RadarView } from "@/components/RadarView";
import type { RadarActions, RadarTab } from "@/components/ReleaseItem";
import { Shell, useWorkspace } from "@/components/Shell";
import { useChicagoDayKey } from "@/lib/date";

// Plan 8 Task 6: the Release radar. The tab is kept in the URL (?tab=cosign) so Today's co-sign line and a reload land
// on it. Each action is a Convex mutation run as the signed-in person; Convex refuses anyone else in plain words.
// Task 6b: the search box searches both tabs in Convex (the search index) after a short pause.

const SEARCH_PAUSE_MS = 250;

/** The last answer while a new one loads, so the list does not flash "Loading…" on every keystroke. */
function useKept<T>(value: T | undefined): T | undefined {
  const kept = useRef<T | undefined>(undefined);
  if (value !== undefined) kept.current = value;
  return value === undefined ? kept.current : value;
}

function RadarBody() {
  const router = useRouter();
  const tab: RadarTab = useSearchParams().get("tab") === "cosign" ? "cosign" : "bandcamp";
  const workspace = useWorkspace();
  const today = useChicagoDayKey();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), SEARCH_PAUSE_MS);
    return () => clearTimeout(t);
  }, [search]);
  const searchArg = query ? { search: query } : {};
  // Both tabs: each tab label shows its count of new records (within the search, when there is one).
  const bandcamp = useKept(useQuery(api.radar.list, { tab: "bandcamp", ...searchArg }));
  const cosign = useKept(useQuery(api.radar.list, { tab: "cosign", ...searchArg }));
  // [] for anyone but a real human, so the demo never shows the list.
  const notAdded = useQuery(api.radar.notAdded, {});
  const setStatus = useMutation(api.radar.setStatus);
  const edit = useMutation(api.radar.edit);
  const setEmbargo = useMutation(api.radar.setEmbargo);
  const retry = useMutation(api.radar.retry);
  const retryEmbed = useMutation(api.radar.retryEmbed);
  const pastePlayer = useMutation(api.radar.pastePlayer);
  const setFavorite = useMutation(api.radar.setFavorite);
  const id = (releaseId: string) => releaseId as Id<"releases">;
  const actions: RadarActions = {
    setStatus: (a) => setStatus({ ...a, releaseId: id(a.releaseId) }),
    edit: (a) => edit({ ...a, releaseId: id(a.releaseId) }),
    setEmbargo: (a) => setEmbargo({ ...a, releaseId: id(a.releaseId) }),
    retry,
    retryEmbed: (a) => retryEmbed({ releaseId: id(a.releaseId) }),
    pastePlayer: (a) => pastePlayer({ releaseId: id(a.releaseId), pasted: a.pasted }),
    setFavorite: (a) => setFavorite({ ...a, releaseId: id(a.releaseId) }),
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
      search={search}
      onSearchChange={setSearch}
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
