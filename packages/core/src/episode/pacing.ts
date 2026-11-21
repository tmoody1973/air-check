import { episodeStatus, type EpisodeFacts } from "./status";

const oldestFirst = (a: EpisodeFacts, b: EpisodeFacts) => a.showDate.localeCompare(b.showDate);

/**
 * Nov 21: 11-13-26 waited a day for its audio behind three backlog shows. A show that aired in the last
 * RECENT_SHOW_DAYS (or hasn't aired yet) goes ahead of the backlog and is never held back by the pace of 3.
 */
export const RECENT_SHOW_DAYS = 14;
export const isRecentShow = (showDate: string, now: number): boolean =>
  now - Date.parse(`${showDate}T00:00:00Z`) < (RECENT_SHOW_DAYS + 1) * 86_400_000;

/** With a clock: the newest recent show that `due` accepts. Without one (old callers, tests): none. */
const recentFirst = (episodes: EpisodeFacts[], due: (e: EpisodeFacts) => boolean, now?: number) =>
  now === undefined ? undefined : [...episodes].sort(oldestFirst).reverse().find((e) => isRecentShow(e.showDate, now) && due(e));

/**
 * Oldest show that needs its audio fetched, or null once `max` backlog shows' audio is on disk. Only shows with a
 * package (I1): a show that never gets one (draft-failed, rerun, a new question) would otherwise hold its slot forever.
 * Given `now`, a recent show comes first whatever `onDiskCount` is (callers count only backlog shows).
 */
export function nextAudioToFetch(episodes: EpisodeFacts[], onDiskCount: number, max = 3, now?: number): EpisodeFacts | null {
  const due = (e: EpisodeFacts) =>
    e.audio.status === "ready" && !e.audioOnDisk && ["drafting", "awaiting-review"].includes(episodeStatus(e).status);
  const recent = recentFirst(episodes, due, now);
  if (recent) return recent;
  if (onDiskCount >= max) return null;
  return [...episodes].sort(oldestFirst).find(due) ?? null;
}

/** Oldest ready-to-draft show, or null while `max` packages already await review. Given `now`, a recent show first, always. */
export function nextToDraft(episodes: EpisodeFacts[], awaitingReview: number, max = 3, now?: number): EpisodeFacts | null {
  const due = (e: EpisodeFacts) => episodeStatus(e).status === "ready-to-draft";
  const recent = recentFirst(episodes, due, now);
  if (recent) return recent;
  if (awaitingReview >= max) return null;
  return [...episodes].sort(oldestFirst).find(due) ?? null;
}
