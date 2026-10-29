"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PackageDecision, type CoverChangeFn, type DecideFn, type DescriptionSaveFn, type SettleFns, type TracklistSaveFn, type UpdateFns } from "@/components/PackageDecision";
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
  const reopenMutation = useMutation(api.packages.reopen);
  const confirmMutation = useMutation(api.packages.confirmPosted);
  const editDescriptionMutation = useMutation(api.packages.editDescription);
  const editTracklistMutation = useMutation(api.packages.editTracklist);
  const updateView = useQuery(api.descriptionUpdates.forPackage, { packageId: id });
  const proposeMutation = useMutation(api.descriptionUpdates.propose);
  const approveUpdateMutation = useMutation(api.descriptionUpdates.approve);

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

  // I2: signed-in staff settle a failed or uncertain upload. Convex refuses anyone else; the demo never sees them.
  const settle: SettleFns = {
    reopen: () => reopenMutation({ packageId: id }),
    confirmPosted: (url) => confirmMutation({ packageId: id, url }),
  };

  // Plan 5c: the host rewrites the description before approving. Convex refuses anyone but a signed-in real human.
  const editDescription: DescriptionSaveFn = (description) => editDescriptionMutation({ packageId: id, description });
  // R7: the host fixes a track (the agent can't); same rule as the description.
  const editTracklist: TracklistSaveFn = (text) => editTracklistMutation({ packageId: id, text });

  // Plan 5c Task 4: a show already on Mixcloud. Convex lets only a signed-in real human propose or approve.
  const updateFns: UpdateFns = {
    propose: (description) => proposeMutation({ packageId: id, description }),
    approve: (updateId, fingerprint) => approveUpdateMutation({ id: updateId as Id<"descriptionUpdates">, fingerprint }),
  };

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
          settle={workspace === "real" ? settle : undefined}
          editDescription={workspace === "real" ? editDescription : undefined}
          editTracklist={workspace === "real" ? editTracklist : undefined}
          descriptionUpdate={workspace === "real" ? { view: updateView, fns: updateFns } : undefined}
        />
      )}
    </Shell>
  );
}
