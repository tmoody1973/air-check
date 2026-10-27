import type { PackageRecord, PackageStatus, PackageStore } from "@aircheck/core";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Workspace = "real" | "demo";

/** Convex rejects `undefined` inside stored values (revise can leave `hour1DurationSec: undefined`). */
export function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function toRecord(doc: Doc<"packages">): PackageRecord {
  const { _id, _creationTime, packageId, workspace, ...rec } = doc;
  void _id, _creationTime, packageId, workspace;
  return rec as PackageRecord;
}

async function find(ctx: QueryCtx, packageId: string) {
  return ctx.db
    .query("packages")
    .withIndex("by_packageId", (q) => q.eq("packageId", packageId))
    .unique();
}

/**
 * PackageStore over Convex. A mutation is one transaction, so the read and patch in
 * compareAndSwap are atomic. When `workspace` is given, other workspaces read as missing.
 */
export function convexPackageStore(ctx: MutationCtx, workspace?: Workspace): PackageStore {
  return {
    async get(id) {
      const doc = await find(ctx, id);
      if (!doc || (workspace && doc.workspace !== workspace)) return null;
      return toRecord(doc);
    },
    async put(rec) {
      const clean = stripUndefined(rec);
      await ctx.db.insert("packages", { ...clean, packageId: rec.draft.id, workspace: rec.draft.workspace });
    },
    async compareAndSwap(id, expected, next) {
      const doc = await find(ctx, id);
      if (!doc || doc.status !== expected.status) return null;
      if (expected.fingerprint !== undefined && doc.fingerprint !== expected.fingerprint) return null;
      const patch: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(next)) patch[k] = val === undefined ? undefined : stripUndefined(val);
      await ctx.db.patch(doc._id, patch);
      const updated = await ctx.db.get(doc._id);
      return updated ? toRecord(updated) : null;
    },
  };
}

export type { PackageStatus };
