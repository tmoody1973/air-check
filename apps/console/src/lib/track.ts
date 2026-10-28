import type { PackageRecord } from "@aircheck/core";
import type { PlayerTrack } from "../components/PlayerProvider";
import type { Workspace } from "../components/Shell";

// The prepared MP3 exists from awaiting_review until the media service cleans it up (succeeded or skipped).
const HAS_MP3 = new Set<PackageRecord["status"]>(["awaiting_review", "approved", "publishing", "failed", "outcome_unknown"]);

/**
 * Demo plays the bundled synthetic sample (10 s per "hour") and never the audio route. Real plays the joined MP3
 * through /api/audio; `?v=` changes when the MP3 does, so a re-prepared show never resumes the old file. Hour 2
 * starts at the hour-1 file's length: an hour boundary, not a track time (Hard Rule 11).
 */
export function trackFor(workspace: Workspace, rec: PackageRecord): PlayerTrack | null {
  const { id, title, audio } = rec.draft;
  if (workspace === "demo") return { src: "/demo/sample-hour.mp3", title, durationSec: 20, hour2AtSec: 10 };
  if (!audio.mp3Sha256 || !HAS_MP3.has(rec.status)) return null;
  return {
    src: `/api/audio/${encodeURIComponent(id)}?v=${audio.mp3Sha256.slice(0, 12)}`,
    title,
    ...(audio.hour1DurationSec !== undefined ? { hour2AtSec: audio.hour1DurationSec } : {}),
  };
}
