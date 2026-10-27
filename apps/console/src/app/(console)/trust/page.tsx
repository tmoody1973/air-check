"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { SandboxChipLive } from "@/components/SandboxChipLive";
import { SampleTag } from "@/components/SampleTag";
import { Shell, useWorkspace } from "@/components/Shell";
import { Timeline, parseFilter, type TrustFilter } from "@/components/Timeline";

function TrustBody() {
  const rows = useQuery(api.activity.list, {});
  const router = useRouter();
  const filter = parseFilter(useSearchParams().get("filter"));
  const demo = useWorkspace() === "demo";
  const pick = (f: TrustFilter) => router.replace(f === "all" ? "/trust" : `/trust?filter=${f}`);

  if (rows === undefined) return <p className="text-ink-soft">Loading…</p>;
  return (
    <>
      <p className="mb-3 flex flex-wrap items-center gap-2">
        {demo ? <SampleTag /> : null}
        <SandboxChipLive />
      </p>
      <Timeline rows={rows} filter={filter} onFilterChange={pick} />
    </>
  );
}

export default function TrustPage() {
  return (
    <Shell title="Trust">
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <TrustBody />
      </Suspense>
    </Shell>
  );
}
