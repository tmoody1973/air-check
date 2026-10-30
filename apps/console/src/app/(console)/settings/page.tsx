"use client";

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { BookmarkletSetup } from "@/components/BookmarkletLink";
import { MixcloudConnection, noticeFrom } from "@/components/MixcloudConnection";
import { Shell, useWorkspace } from "@/components/Shell";
import { SourceConnections, SourceNotice, sourceNoticeFrom } from "@/components/SourceConnections";
import { useChicagoDayKey } from "@/lib/date";

/** Plan 7: today's Tavily searches against the daily cap, counted in Convex (research.searchUsage). */
function WebSearchUsage() {
  const today = useChicagoDayKey();
  const usage = useQuery(api.research.searchUsage, { today });
  if (!usage) return null;
  return (
    <section aria-labelledby="web-search-h" className="mx-auto w-full max-w-xl rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="web-search-h" className="text-base font-semibold">Web search (Tavily)</h2>
        <p className="text-sm tabular-nums text-ink-soft">{`${usage.used} of ${usage.cap} searches used today${usage.credits !== undefined ? ` · ${usage.credits} credits` : ""}`}</p>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">Research stops searching at the cap and marks what is left could-not-verify. Resets at midnight in Milwaukee.</p>
    </section>
  );
}

function SettingsBody() {
  const status = useQuery(api.mixcloud.get, {});
  const sources = useQuery(api.episodes.sources, {});
  const params = useSearchParams();
  const sourceNotice = sourceNoticeFrom(params);
  const workspace = useWorkspace();
  return (
    <div className="flex min-w-0 flex-col gap-10">
      <div className="flex min-w-0 flex-col gap-4">
        {/* A source's outcome sits at the top, where the Mixcloud one does: the page reloads scrolled to the top. */}
        {sourceNotice && (
          <div className="mx-auto w-full max-w-xl">
            <SourceNotice notice={sourceNotice} />
          </div>
        )}
        <MixcloudConnection status={status} workspace={workspace} notice={noticeFrom(params)} />
      </div>
      <SourceConnections sources={sources} workspace={workspace} />
      <WebSearchUsage />
      {workspace === "real" && <BookmarkletSetup boxed />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Shell title="Settings">
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <SettingsBody />
      </Suspense>
    </Shell>
  );
}
