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
});
