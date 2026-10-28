import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const workspaceV = v.union(v.literal("real"), v.literal("demo"));
export const resultV = v.union(v.literal("needs_you"), v.literal("done"), v.literal("allowed"), v.literal("blocked"));
export const kindV = v.union(v.literal("waiting"), v.literal("action"), v.literal("network"));

export const mixcloudStatusFields = {
  state: v.union(v.literal("connected"), v.literal("needs_reconnect"), v.literal("not_connected")),
  account: v.optional(v.string()),
  connectedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
};

export const runStatusV = v.union(
  v.literal("queued"), v.literal("running"), v.literal("stopping"),
  v.literal("completed"), v.literal("cancelled"), v.literal("failed"),
);

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
    // `at`: when the publisher reported the result (ISO); paces the 3-per-day limit.
    result: v.optional(v.object({ url: v.optional(v.string()), error: v.optional(v.string()), at: v.optional(v.string()) })),
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
    // Audit-log dedupe key (network rows written by the relay).
    key: v.optional(v.string()),
  })
    .index("by_workspace_at", ["workspace", "at"])
    .index("by_workspace_key", ["workspace", "key"]),
  // Why a show's audio is not ready yet. The media service replaces the whole set on every scan (media.waiting).
  audioIssues: defineTable({ showDate: v.string(), reason: v.string(), updatedAt: v.number() }),
  // One row (real workspace). Hard Rule 2: no credential here; the Mixcloud token lives only in the publisher's token file.
  mixcloudStatus: defineTable(mixcloudStatusFields),
  // One row per workspace, upserted by the relay every few minutes (relay.status).
  sandboxStatus: defineTable({
    workspace: workspaceV,
    phase: v.union(v.string(), v.null()),
    allowedHosts: v.number(),
    at: v.number(),
  }).index("by_workspace", ["workspace"]),
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
    // Plan 4b fields are optional so Plan-3-era rows still satisfy the schema (see runDefaults.ts).
    kind: v.optional(v.union(v.literal("chat"), v.literal("draft-package"))),
    source: v.optional(v.union(v.literal("live"), v.literal("scripted"))),
    status: v.optional(runStatusV),
    input: v.optional(v.string()), // the Hermes instruction, built at queue time
    instructions: v.optional(v.string()), // core RUN_INSTRUCTIONS, sent as Hermes `instructions` (live runs only)
    stopRequested: v.optional(v.boolean()),
    hermesRunId: v.optional(v.string()),
    conversationId: v.optional(v.string()), // also Hermes's session_id
    sessionKey: v.optional(v.string()), // demo rate-limit key
    packageId: v.optional(v.string()),
    form: v.optional(v.object({ showDate: v.string(), tracklistText: v.string(), notes: v.string() })),
    lastSeq: v.optional(v.number()), // highest relay event seq applied
    createdAt: v.optional(v.number()),
  })
    .index("by_runId", ["runId"])
    .index("by_status", ["status"])
    .index("by_session_created", ["sessionKey", "createdAt"])
    .index("by_workspace_source_created", ["workspace", "source", "createdAt"]),
  conversations: defineTable({
    workspace: workspaceV,
    title: v.string(),
    createdAt: v.number(),
  }).index("by_workspace_created", ["workspace", "createdAt"]),
  messages: defineTable({
    workspace: workspaceV,
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    runId: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_conversation", ["conversationId"]) // creation order
    .index("by_runId", ["runId"]),
});
