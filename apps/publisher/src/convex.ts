import type { PackageDraft } from "@aircheck/core";
import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server"; // untyped on purpose, like the relay and media

export interface QueueItem { packageId: string; showDate: string; decidedAt?: string; draft: PackageDraft; fingerprint?: string; coverStorageId?: string }
export interface ReviewItem { packageId: string; title: string; trackCount: number; flagCount: number }
/** Hard Rule 2: state, account name, time and a short error code. Never a credential. */
export interface MixcloudStatus { state: "connected" | "needs_reconnect" | "not_connected"; account?: string; connectedAt?: number; lastError?: string }
export type PublishResult = { status: "succeeded"; url: string } | { status: "failed"; error: string } | { status: "outcome_unknown" };

/** Everything the publisher needs from Convex. The token lives inside the real implementation. */
export interface PublisherConvex {
  queue(): Promise<{ packages: QueueItem[]; publishedToday: number }>;
  claim(packageId: string): Promise<void>;
  result(packageId: string, result: PublishResult): Promise<void>;
  unclaim(packageId: string): Promise<void>;
  reconcile(): Promise<string[]>;
  coverUrl(storageId: string): Promise<string>;
  setMixcloud(status: MixcloudStatus): Promise<void>;
  awaitingReview(): Promise<ReviewItem[]>;
}

export const CONVEX_TIMEOUT_MS = 15_000;

export function connectConvex(url: string, token: string): PublisherConvex {
  const client = new ConvexHttpClient(url, { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(CONVEX_TIMEOUT_MS) }) });
  const p = anyApi.publisher as unknown as Record<"queue" | "coverUrl" | "awaitingReview", FunctionReference<"query">> &
    Record<"claim" | "result" | "unclaim" | "reconcile" | "setMixcloud", FunctionReference<"mutation">>;
  return {
    queue: () => client.query(p.queue, { token }),
    claim: async (packageId) => void (await client.mutation(p.claim, { token, packageId })),
    result: async (packageId, result) => void (await client.mutation(p.result, { token, packageId, result })),
    unclaim: async (packageId) => void (await client.mutation(p.unclaim, { token, packageId })),
    reconcile: async () => ((await client.mutation(p.reconcile, { token })) as { reconciled: string[] }).reconciled,
    coverUrl: (storageId) => client.query(p.coverUrl, { token, storageId }),
    setMixcloud: async (status) => void (await client.mutation(p.setMixcloud, { token, ...status })),
    awaitingReview: () => client.query(p.awaitingReview, { token }),
  };
}
