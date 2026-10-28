import { episodeStatus, type EpisodeFacts } from "./status";

const oldestFirst = (a: EpisodeFacts, b: EpisodeFacts) => a.showDate.localeCompare(b.showDate);

/** Oldest show that needs its audio fetched, or null once `max` shows' audio is on disk. */
export function nextAudioToFetch(episodes: EpisodeFacts[], onDiskCount: number, max = 3): EpisodeFacts | null {
  if (onDiskCount >= max) return null;
  return (
    [...episodes]
      .sort(oldestFirst)
      .find(
        (e) =>
          e.audio.status === "ready" &&
          !e.audioOnDisk &&
          ["ready-to-draft", "drafting", "awaiting-review"].includes(episodeStatus(e).status),
      ) ?? null
  );
}

/** Oldest ready-to-draft show, or null while `max` packages already await review. */
export function nextToDraft(episodes: EpisodeFacts[], awaitingReview: number, max = 3): EpisodeFacts | null {
  if (awaitingReview >= max) return null;
  return [...episodes].sort(oldestFirst).find((e) => episodeStatus(e).status === "ready-to-draft") ?? null;
}
