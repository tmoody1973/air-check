import type { ParsedTracklist } from "../types";
import { parseTracklist } from "./parse";

const SPACED_DASH = /\s[-–—]\s/;

/** Drive's text export, read by core. A title or byline above HOUR 1 is not a track; a track-like line there still is. */
export function parseDriveTracklist(text: string): ParsedTracklist {
  const p = parseTracklist(text);
  return { tracks: p.tracks, bad: p.bad.filter((b) => b.reason !== "before-hour-marker" || SPACED_DASH.test(b.raw)) };
}
