export type Station = "88nine" | "hyfin";

const ALLOWED: readonly Station[] = ["88nine", "hyfin"];

/** Hard Rule 3: play history is 88nine and hyfin only. `rhythmlab` is the 24/7 stream, never the show. */
export function assertStation(s: string): Station {
  if (!(ALLOWED as readonly string[]).includes(s)) throw new Error(`station not allowed: ${s}`);
  return s as Station;
}
