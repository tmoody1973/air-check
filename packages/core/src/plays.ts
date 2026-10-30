import { chicagoDayKey } from "./publish/pacing";
import { credits } from "./radar/embargo";
import { assertStation } from "./stations";
import { normalize } from "./tracklist/normalize";

/**
 * The one client for 88Nine and HYFIN play history: rm-playlist-v2's public, read-only query endpoint (spike V7). No
 * credentials. Never run `convex dev`, `deploy` or `codegen` against this shared deployment.
 */
export const PLAYS_URL = "https://precise-fish-444.convex.cloud/api/query";
const WINDOW_MS = 90 * 86_400_000;
const LIMIT = 500;
const TIMEOUT_MS = 10_000;

type Play = { artist: string; artistRaw?: string; playedAt: number };
const isPlay = (p: unknown): p is Play =>
  !!p && typeof (p as Play).artist === "string" && typeof (p as Play).playedAt === "number" && Number.isFinite((p as Play).playedAt);

/**
 * The America/Chicago day (YYYY-MM-DD) `artist` was last played on `station` within the last 90 days, or null. Hard
 * Rule 3: the station is checked before anything else, because the endpoint also answers for `rhythmlab`. An exact
 * normalized match on the play's artist, or on one credit of its raw artist ("Justine Skye & KAYTRANADA"). No count:
 * the search can cover less than 90 days (V7), so a count could be wrong. Only the day is kept, never a time.
 * Throws on a failed or malformed answer, so a caller never mistakes an outage for "not played".
 */
export async function lastPlayed(fetch: typeof globalThis.fetch, station: string, artist: string): Promise<string | null> {
  const stationSlug = assertStation(station);
  const name = normalize(artist);
  if (!name) return null;
  const now = Date.now();
  const res = await fetch(PLAYS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "plays:searchByStation", args: { stationSlug, q: artist, afterMs: now - WINDOW_MS, beforeMs: now, limit: LIMIT }, format: "json" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`play history: HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; value?: unknown };
  if (body.status !== "success" || !Array.isArray(body.value)) throw new Error("play history: unexpected answer");
  const newest = body.value
    .filter(isPlay)
    .filter((p) => normalize(p.artist) === name || credits(p.artistRaw ?? "").has(name))
    .reduce((max, p) => Math.max(max, p.playedAt), -Infinity);
  return newest === -Infinity ? null : chicagoDayKey(newest);
}
