"use client";

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { MixcloudConnection, noticeFrom } from "@/components/MixcloudConnection";
import { Shell, useWorkspace } from "@/components/Shell";
import { SourceConnections, SourceNotice, sourceNoticeFrom } from "@/components/SourceConnections";

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
