"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
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
      {demo ? (
        <p className="mb-3">
          <SampleTag />
        </p>
      ) : null}
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
