import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const workspaceV = v.union(v.literal("real"), v.literal("demo"));
export const resultV = v.union(v.literal("needs_you"), v.literal("done"), v.literal("allowed"), v.literal("blocked"));
export const kindV = v.union(v.literal("waiting"), v.literal("action"), v.literal("network"));

export default defineSchema({
  packages: defineTable({
    packageId: v.string(),
    workspace: workspaceV,
    status: v.string(),
    // PackageDraft is validated by core's types and the gate, not re-declared here.
    draft: v.any(),
    fingerprint: v.optional(v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.string()),
    result: v.optional(v.object({ url: v.optional(v.string()), error: v.optional(v.string()) })),
  })
    .index("by_packageId", ["packageId"])
    .index("by_workspace_status", ["workspace", "status"]),
  activity: defineTable({
    workspace: workspaceV,
    at: v.number(),
    kind: kindV,
    title: v.string(),
    destination: v.optional(v.string()),
    result: resultV,
    reason: v.optional(v.string()),
    packageId: v.optional(v.string()),
  }).index("by_workspace_at", ["workspace", "at"]),
  verifications: defineTable({
    workspace: workspaceV,
    claim: v.string(),
    status: v.union(v.literal("conflict"), v.literal("could-not-verify"), v.literal("confirmed")),
    show: v.optional(v.string()),
  }).index("by_workspace_status", ["workspace", "status"]),
  releases: defineTable({
    workspace: workspaceV,
    artist: v.string(),
    title: v.string(),
    label: v.optional(v.string()),
    type: v.optional(v.union(v.literal("album"), v.literal("single"), v.literal("ep"))),
    releasedOn: v.optional(v.string()),
    playedNote: v.optional(v.string()),
  }).index("by_workspace", ["workspace"]),
  runs: defineTable({
    workspace: workspaceV,
    runId: v.string(),
    title: v.string(),
    state: v.any(), // RunState, typed by core
    // Display-only Next/Skipped rows; the seed (Task 13) stores them.
    upcoming: v.optional(v.array(v.object({ label: v.string(), text: v.string(), status: v.union(v.literal("next"), v.literal("skipped")) }))),
    updatedAt: v.number(),
  }).index("by_runId", ["runId"]),
});
