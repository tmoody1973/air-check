import type { BandcampEmbed, LinkedPackageStatus, RadarTab, ReleaseFields } from "@aircheck/core";
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
/** Plan 6b: Tarik put a doc or folder whose name can't be dated on a show date, in the console. Never written back. */
export interface Placement { source: "box" | "drive" | "paper"; id: string; date: string }
/** Plan 6b: a doc or folder whose name holds a date the scanner can't read (e.g. "9-4-226"), listed on Episodes. */
export interface Unplaced { source: Placement["source"]; id: string; name: string; reason: string }
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
  /** R4 (Plan 6b): the `updatedAt` of the correction this scan saw for the date, stale or not; absent when none. */
  appliedCorrectionAt?: number;
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
  /** R4: a fix or placement saved since this show's last scan; drafting waits for the rescan. */
  rescanPending?: boolean;
  /** Present when the show has a correction; `stale`: it points at something gone (R1). Convex sends more fields. */
  corrected?: { stale: boolean };
}

/** In the backlog: a 2026 date, or a 2025 Friday Tarik added (ingest.list's extraDates). */
export const inBacklog = (date: string, extraDates: readonly string[] = []) => date.startsWith("2026-") || extraDates.includes(date);

export type DraftOutcome = { queued: true; runId: string } | { queued: false; reason: string };
export interface SourceReport { source: "box" | "google" | "dropbox"; state: "connected" | "needs_reconnect" | "not_connected"; account?: string; lastError?: string }

/** Everything the ingest service needs from Convex. The token lives inside the real implementation. */
export interface IngestConvex {
  /**
   * `rescanAfter`: the newest correction, placement, undo or added/removed 2025 date (0 for none); newer than the last
   * scan asks for a rescan. `extraDates`: the 2025 Fridays Tarik added (absent from a Convex deployed before them).
   */
  list(): Promise<{ episodes: IngestRow[]; awaitingReview: number; corrections: Correction[]; placements: Placement[]; rescanAfter: number; extraDates?: string[] }>;
  upsert(episode: ScannedEpisode): Promise<void>;
  setFetch(showDate: string, status: "fetching" | "fetched" | "failed", error?: string): Promise<void>;
  requestDraft(showDate: string): Promise<DraftOutcome>;
  sourceStatus(report: SourceReport): Promise<void>;
  /** I3: remove rows for dates not in `keep`; Convex refuses (skipped) when that would be more than 3. */
  prune(keep: string[]): Promise<{ deleted: number; skipped?: number }>;
  /** Plan 6b: the names a complete scan could not date, replacing the last list. */
  reportUnplaced(items: Unplaced[]): Promise<void>;
}

/** Plan 8: one stored email as radar.pending returns it. The body is cleaned text: no link, no address. */
export interface PendingEmail { messageId: string; tab: RadarTab; subject: string; body: string; receivedAt: number }
/** Mirrors outcomeV in apps/console/convex/radar.ts: any other key is refused by its validator. */
export type RadarOutcome = { kind: "saved"; release: ReleaseFields } | { kind: "not-a-release" | "refused" | "failed"; reasons: string[] };
export type EmbedOutcome = BandcampEmbed | { failed: string };
/** The radar code's only Convex calls (Plan 8 Global Constraints): radar.pending, record, embedsWanted, embedResult. */
export interface RadarConvex {
  pending(): Promise<PendingEmail[]>;
  record(messageId: string, outcome: RadarOutcome): Promise<void>;
  embedsWanted(): Promise<{ releaseId: string; pageUrl: string }[]>;
  embedResult(releaseId: string, pageUrl: string, result: EmbedOutcome): Promise<void>;
}

/** Like media and the publisher: a Convex call that never answers fails instead of wedging the pass. */
export const CONVEX_TIMEOUT_MS = 15_000;

export function connectConvex(url: string, token: string, timeoutMs = CONVEX_TIMEOUT_MS): IngestConvex & { radar: RadarConvex } {
  const client = new ConvexHttpClient(url, { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) });
  const m = anyApi.ingest as unknown as Record<"list", FunctionReference<"query">> & Record<"upsert" | "setFetch" | "requestDraft" | "sourceStatus" | "prune" | "reportUnplaced", FunctionReference<"mutation">>;
  const r = anyApi.radar as unknown as Record<"pending" | "embedsWanted", FunctionReference<"query">> & Record<"record" | "embedResult", FunctionReference<"mutation">>;
  return {
    radar: {
      pending: () => client.query(r.pending, { token }),
      record: async (messageId, outcome) => void (await client.mutation(r.record, { token, messageId, outcome })),
      embedsWanted: () => client.query(r.embedsWanted, { token }),
      embedResult: async (releaseId, pageUrl, result) => void (await client.mutation(r.embedResult, { token, releaseId, pageUrl, result })),
    },
    list: () => client.query(m.list, { token }),
    upsert: async (episode) => void (await client.mutation(m.upsert, { token, episode })),
    setFetch: async (showDate, status, error) => void (await client.mutation(m.setFetch, { token, showDate, status, ...(error ? { error } : {}) })),
    requestDraft: (showDate) => client.mutation(m.requestDraft, { token, showDate }),
    sourceStatus: async (r) => void (await client.mutation(m.sourceStatus, { token, ...r })),
    prune: (keep) => client.mutation(m.prune, { token, keep }),
    reportUnplaced: async (items) => void (await client.mutation(m.reportUnplaced, { token, items })),
  };
}
