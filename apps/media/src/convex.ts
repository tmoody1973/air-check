import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server"; // untyped on purpose, like the relay: the console's generated api would drag its tsconfig in

export interface PendingPackage { packageId: string; showDate: string }
export interface Attached { packageId: string; hour1Id: string; hour2Id: string; mp3Sha256: string; hour1DurationSec: number; mp3Bytes: number }
export interface WaitingItem { showDate: string; reason: string }
export interface PackageStatus { packageId: string; status: string }

/** Everything the media service needs from Convex. The token lives inside the real implementation. */
export interface MediaConvex {
  pending(): Promise<PendingPackage[]>;
  attached(a: Attached): Promise<void>;
  waiting(items: WaitingItem[]): Promise<void>;
  cleanup(): Promise<string[]>;
  /** Status of each real package asked about (demo and unknown ids are left out). */
  statuses(packageIds: string[]): Promise<PackageStatus[]>;
}

/** Like the publisher: a Convex call that never answers fails instead of wedging the pass. */
export const CONVEX_TIMEOUT_MS = 15_000;

export function connectConvex(url: string, token: string, timeoutMs = CONVEX_TIMEOUT_MS): MediaConvex {
  const client = new ConvexHttpClient(url, { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) });
  const m = anyApi.media as unknown as Record<"pending" | "cleanup" | "statuses", FunctionReference<"query">> & Record<"attached" | "waiting", FunctionReference<"mutation">>;
  return {
    pending: () => client.query(m.pending, { token }),
    attached: async (a) => void (await client.mutation(m.attached, { token, ...a })),
    waiting: async (items) => void (await client.mutation(m.waiting, { token, items })),
    cleanup: () => client.query(m.cleanup, { token }),
    statuses: (packageIds) => client.query(m.statuses, { token, packageIds }),
  };
}
