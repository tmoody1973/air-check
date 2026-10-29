import type { LinkedPackageStatus } from "@aircheck/core";
import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server"; // untyped on purpose, like media: the console's generated api would drag its tsconfig in

// Mirrors scannedEpisodeFields in apps/console/convex/schema.ts. Hard Rule 2/11: no credential, URL or start time.
export interface FileRef { id: string; name: string; size: number }
export type QuestionKind = "audio" | "date" | "tracklist" | "rerun";
export interface ScannedTrack {
  hour: 1 | 2; position: number; artist: string; title: string; feat?: string; raw: string; closing: boolean;
  status: "confirmed" | "spelling-fixed" | "unverified-in-notes" | "closing-track";
}
export interface Choice { id: string; name: string }
/** Plan 6b: what the console can offer to settle a question. Convex accepts only ids a question offered. */
export type Fix =
  | { type: "tracklist" }
  | { type: "pick"; source: "box" | "drive" | "paper"; choices: Choice[] }
  | { type: "hours"; choices: Choice[] }
  | { type: "stamp"; folderDate: string; stampDate: string };
export interface Question { id: string; text: string; kind: QuestionKind; rerunOf?: string; action?: true; fix?: Fix }
/** Plan 6b: a fix Tarik saved in Air Check for one show (decision 017). Written only by a signed-in person. */
export interface Correction {
  showDate: string;
  /** Used exactly as typed: Paper never changes its spelling. */
  tracklistText?: string;
  drive?: string; paper?: string; box?: string;
  hours?: { hour1: string; hour2: string };
  folderDate?: true;
  updatedAt: number;
}
export interface ScannedEpisode {
  showDate: string;
  audio: { status: "ready" | "incomplete" | "ask" | "none"; folderId?: string; hour1?: FileRef; hour2?: FileRef; pattern?: string; flags: string[] };
  /** `text`: the chosen Drive doc's text (at most 20,000 characters), for the console's tracklist editor; kept private. */
  tracklist: { status: "found" | "missing"; docId?: string; tracks?: ScannedTrack[]; text?: string };
  /** `text` is Paper text: sent only here, for the draft's untrusted-notes input (Hard Rule 12). */
  notes: { status: "found" | "missing"; docId?: string; text?: string };
  /** `action`: only fixing the source settles it (M6); Episodes shows no answer box. */
  questions: Question[];
  audioOnDisk?: boolean;
  /** R1 (Plan 6b): this show's correction points at something no source has any more, so it was not used. */
  correctionStale?: true;
}

/** One row of ingest.list: the scanned facts without the notes text, plus what Convex knows. */
export interface IngestRow {
  showDate: string;
  audio: ScannedEpisode["audio"];
  tracklist: { status: "found" | "missing"; docId?: string };
  notes: { status: "found" | "missing"; docId?: string };
  tracks?: ScannedTrack[];
  questions: (Question & { answer?: string })[];
  audioOnDisk?: boolean;
  rerunOf?: string;
  rerunSource?: "chat" | "episodes" | "detected";
  rerunDeclined?: true;
  packageStatus: LinkedPackageStatus;
  draftAttempts: number;
  status: string;
}

export type DraftOutcome = { queued: true; runId: string } | { queued: false; reason: string };
export interface SourceReport { source: "box" | "google" | "dropbox"; state: "connected" | "needs_reconnect" | "not_connected"; account?: string; lastError?: string }

/** Everything the ingest service needs from Convex. The token lives inside the real implementation. */
export interface IngestConvex {
  list(): Promise<{ episodes: IngestRow[]; awaitingReview: number }>;
  upsert(episode: ScannedEpisode): Promise<void>;
  setFetch(showDate: string, status: "fetching" | "fetched" | "failed", error?: string): Promise<void>;
  requestDraft(showDate: string): Promise<DraftOutcome>;
  sourceStatus(report: SourceReport): Promise<void>;
  /** I3: remove rows for dates not in `keep`; Convex refuses (skipped) when that would be more than 3. */
  prune(keep: string[]): Promise<{ deleted: number; skipped?: number }>;
}

/** Like media and the publisher: a Convex call that never answers fails instead of wedging the pass. */
export const CONVEX_TIMEOUT_MS = 15_000;

export function connectConvex(url: string, token: string, timeoutMs = CONVEX_TIMEOUT_MS): IngestConvex {
  const client = new ConvexHttpClient(url, { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) });
  const m = anyApi.ingest as unknown as Record<"list", FunctionReference<"query">> & Record<"upsert" | "setFetch" | "requestDraft" | "sourceStatus" | "prune", FunctionReference<"mutation">>;
  return {
    list: () => client.query(m.list, { token }),
    upsert: async (episode) => void (await client.mutation(m.upsert, { token, episode })),
    setFetch: async (showDate, status, error) => void (await client.mutation(m.setFetch, { token, showDate, status, ...(error ? { error } : {}) })),
    requestDraft: (showDate) => client.mutation(m.requestDraft, { token, showDate }),
    sourceStatus: async (r) => void (await client.mutation(m.sourceStatus, { token, ...r })),
    prune: (keep) => client.mutation(m.prune, { token, keep }),
  };
}
