"use client";

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { MixcloudConnection, noticeFrom } from "@/components/MixcloudConnection";
import { Shell, useWorkspace } from "@/components/Shell";

function SettingsBody() {
  const status = useQuery(api.mixcloud.get, {});
  const notice = noticeFrom(useSearchParams());
  return <MixcloudConnection status={status} workspace={useWorkspace()} notice={notice} />;
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
