"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PackageDecision, type CoverChangeFn, type DecideFn } from "@/components/PackageDecision";
import { Shell, useWorkspace } from "@/components/Shell";
import { uploadCover } from "@/lib/cover";
import { useChicagoDayKey } from "@/lib/date";

export default function PackagePage() {
  const { id } = useParams<{ id: string }>();
  const workspace = useWorkspace();
  const record = useQuery(api.packages.get, { packageId: id });
  const decideMutation = useMutation(api.packages.decide);
  // These are null (or []) for demo and non-staff callers, so the real-only parts never show in the demo.
  const mixcloud = useQuery(api.mixcloud.get, {});
  // The day is an argument so the queue count follows Chicago midnight; the label uses the same key.
  const today = useChicagoDayKey();
  const publish = useQuery(api.packages.publishState, { packageId: id, today });
  const coverUrl = useQuery(api.packages.coverPreview, { packageId: id });
  const coverUploadUrl = useMutation(api.packages.coverUploadUrl);
  const setCover = useMutation(api.packages.setCover);

  // The fingerprint is the one the host reviewed (pinned in PackageDecision), not the live one.
  const decide: DecideFn = async (decision, fingerprint) => {
    const res = await decideMutation({ packageId: id, fingerprint, decision });
    return res.ok ? { ok: true } : res;
  };
  const changeCover: CoverChangeFn = (file) =>
    uploadCover(file, {
      uploadUrl: () => coverUploadUrl({}),
      setCover: (storageId) => setCover({ packageId: id, storageId: storageId as Id<"_storage"> }),
    });

  return (
    <Shell title="Package">
      {record === undefined ? (
        <p className="text-ink-soft">Loading…</p>
      ) : (
        <PackageDecision
          record={record}
          workspace={workspace}
          decide={decide}
          needsMixcloud={!!mixcloud && mixcloud.state !== "connected"}
          cover={workspace === "real" && coverUrl !== undefined ? { url: coverUrl, change: changeCover } : undefined}
          publish={publish && { ...publish, today }}
          mixcloudAccount={mixcloud?.account}
        />
      )}
    </Shell>
  );
}
