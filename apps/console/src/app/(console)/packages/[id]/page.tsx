"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import { PackageDecision, type DecideFn } from "@/components/PackageDecision";
import { Shell, useWorkspace } from "@/components/Shell";

export default function PackagePage() {
  const { id } = useParams<{ id: string }>();
  const workspace = useWorkspace();
  const record = useQuery(api.packages.get, { packageId: id });
  const decideMutation = useMutation(api.packages.decide);

  // The fingerprint sent is the one on screen; a stale page gets PACKAGE_CHANGED from the gate.
  const decide: DecideFn = async (decision) => {
    const res = await decideMutation({ packageId: id, fingerprint: record?.fingerprint ?? "", decision });
    return res.ok ? { ok: true } : res;
  };

  return (
    <Shell title="Package">
      {record === undefined ? <p className="text-ink-soft">Loading…</p> : <PackageDecision record={record} workspace={workspace} decide={decide} />}
    </Shell>
  );
}
