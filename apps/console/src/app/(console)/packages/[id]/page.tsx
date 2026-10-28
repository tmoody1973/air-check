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
  // Null for demo and non-staff callers, so the hint only ever shows in the real workspace.
  const mixcloud = useQuery(api.mixcloud.get, {});

  // The fingerprint is the one the host reviewed (pinned in PackageDecision), not the live one.
  const decide: DecideFn = async (decision, fingerprint) => {
    const res = await decideMutation({ packageId: id, fingerprint, decision });
    return res.ok ? { ok: true } : res;
  };

  return (
    <Shell title="Package">
      {record === undefined ? <p className="text-ink-soft">Loading…</p> : <PackageDecision record={record} workspace={workspace} decide={decide} needsMixcloud={!!mixcloud && mixcloud.state !== "connected"} />}
    </Shell>
  );
}
