import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server"; // untyped on purpose, like the relay: the console's generated api would drag its tsconfig in

export interface PendingPackage { packageId: string; showDate: string }
export interface Attached { packageId: string; hour1Id: string; hour2Id: string; mp3Sha256: string; hour1DurationSec: number; mp3Bytes: number }
export interface WaitingItem { showDate: string; reason: string }

/** Everything the media service needs from Convex. The token lives inside the real implementation. */
export interface MediaConvex {
  pending(): Promise<PendingPackage[]>;
  attached(a: Attached): Promise<void>;
  waiting(items: WaitingItem[]): Promise<void>;
  cleanup(): Promise<string[]>;
}

export function connectConvex(url: string, token: string): MediaConvex {
  const client = new ConvexHttpClient(url);
  const m = anyApi.media as unknown as Record<"pending" | "cleanup", FunctionReference<"query">> & Record<"attached" | "waiting", FunctionReference<"mutation">>;
  return {
    pending: () => client.query(m.pending, { token }),
    attached: async (a) => void (await client.mutation(m.attached, { token, ...a })),
    waiting: async (items) => void (await client.mutation(m.waiting, { token, items })),
    cleanup: () => client.query(m.cleanup, { token }),
  };
}
