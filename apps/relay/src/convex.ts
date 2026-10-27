import { ConvexClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server"; // untyped on purpose: apps/console's generated api would pull the console's whole tsconfig into this host program

export interface PendingRun {
  runId: string;
  workspace: "real" | "demo";
  kind: "chat" | "draft-package";
  input: string;
  conversationId: string | undefined;
  stopRequested: boolean;
  hermesRunId: string | undefined;
  status: "queued" | "running" | "stopping";
  lastSeq: number | undefined;
}
export interface RunEvent { event: string; data: Record<string, unknown>; t: number; seq: number }
export interface ActivityEvent { key: string; at: number; decision: "allowed" | "blocked"; host: string; port: number; binary?: string; reason?: string }
export type Terminal = "completed" | "cancelled" | "failed";

/** Everything the relay needs from Convex. The token lives inside the real implementation, so callers never hold it. */
export interface RelayConvex {
  subscribePending(onRows: (rows: PendingRun[]) => void, onError: (e: unknown) => void): () => void;
  started(runId: string, hermesRunId: string): Promise<{ started: boolean }>;
  events(runId: string, events: RunEvent[]): Promise<void>;
  finished(runId: string, status: Terminal): Promise<void>;
  activity(workspace: "real" | "demo", events: ActivityEvent[]): Promise<void>;
  status(workspace: "real" | "demo", phase: string | null, allowedHosts: number): Promise<void>;
}

export function connectConvex(url: string, token: string): RelayConvex & { close(): Promise<void> } {
  const client = new ConvexClient(url);
  const r = anyApi.relay as unknown as { pending: FunctionReference<"query">; [m: string]: FunctionReference<"mutation"> | FunctionReference<"query"> } & Record<"started" | "events" | "finished" | "activity" | "status", FunctionReference<"mutation">>;
  return {
    subscribePending: (onRows, onError) => client.onUpdate(r.pending, { token }, (rows: PendingRun[]) => onRows(rows), onError),
    started: (runId, hermesRunId) => client.mutation(r.started, { token, runId, hermesRunId }),
    events: async (runId, events) => void (await client.mutation(r.events, { token, runId, events })),
    finished: async (runId, status) => void (await client.mutation(r.finished, { token, runId, status })),
    activity: async (workspace, events) => void (await client.mutation(r.activity, { token, workspace, events })),
    status: async (workspace, phase, allowedHosts) => void (await client.mutation(r.status, { token, workspace, phase, allowedHosts })),
    close: () => client.close(),
  };
}
