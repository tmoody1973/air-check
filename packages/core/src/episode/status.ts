export type LinkedPackageStatus =
  | "preparing_audio"
  | "awaiting_review"
  | "approved"
  | "publishing"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "skipped"
  | "none";

export interface EpisodeFacts {
  showDate: string;
  /** assemble's statuses, or "none" when no Box folder was found. */
  audio: { status: "ready" | "incomplete" | "ask" | "none" };
  tracklist: { status: "found" | "missing" };
  notes: { status: "found" | "missing" };
  questions: { id: string; text: string; answer?: string }[];
  packageStatus: LinkedPackageStatus;
  /** Set by the ingest service once the WAVs are local. */
  audioOnDisk?: boolean;
}

export type EpisodeStatus =
  | "missing-audio"
  | "missing-tracklist"
  | "question"
  | "ready-to-draft"
  | "drafting"
  | "awaiting-review"
  | "approved"
  | "published"
  | "failed"
  | "outcome-unknown";

export interface EpisodeStatusResult {
  status: EpisodeStatus;
  /** What is absent, in plain words. Notes are a gap, never a blocker. */
  gaps: ("audio" | "tracklist" | "notes")[];
}

const FROM_PACKAGE: Partial<Record<LinkedPackageStatus, EpisodeStatus>> = {
  preparing_audio: "drafting",
  awaiting_review: "awaiting-review",
  approved: "approved",
  publishing: "approved",
  succeeded: "published",
  failed: "failed",
  outcome_unknown: "outcome-unknown",
};

export function episodeStatus(e: EpisodeFacts): EpisodeStatusResult {
  const gaps: EpisodeStatusResult["gaps"] = [];
  if (e.audio.status !== "ready") gaps.push("audio");
  if (e.tracklist.status === "missing") gaps.push("tracklist");
  if (e.notes.status === "missing") gaps.push("notes");

  const fromPackage = FROM_PACKAGE[e.packageStatus];
  if (fromPackage) return { status: fromPackage, gaps };

  // An answered question no longer blocks; an unanswered one, or an audio "ask" nobody has answered, does.
  const unresolved = e.questions.some((q) => !q.answer);
  const audioAsk = e.audio.status === "ask" && e.questions.length === 0;
  if (unresolved || audioAsk) return { status: "question", gaps };
  if (e.audio.status !== "ready") return { status: "missing-audio", gaps };
  if (e.tracklist.status === "missing") return { status: "missing-tracklist", gaps };
  return { status: "ready-to-draft", gaps };
}
