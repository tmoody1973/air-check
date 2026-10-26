import type { BadLine, Hour, ParsedTracklist, Track } from "../types";

const HOUR_MARKER = /^hour\s*(1|2|one|two)\b[\s:–—-]*$/i;
const SPACED_DASH = /\s[-–—]\s/;
const OPEN_QUOTE = /^["“]/;
const CLOSE_QUOTE = /["”]/;
const FEAT_PREFIX = /^(?:feat\.|ft\.|featuring)\s+(.+)$/i;
const TRAILING_FEAT = /^(.*?)\s+(?:feat\.|ft\.|featuring)\s+(.+)$/i;

function splitTitle(rest: string): { title: string; feat?: string } {
  if (OPEN_QUOTE.test(rest)) {
    const close = rest.slice(1).search(CLOSE_QUOTE);
    if (close === -1) return { title: rest.slice(1).trim() };
    const title = rest.slice(1, close + 1);
    const after = rest.slice(close + 2).trim();
    if (!after) return { title };
    const feat = after.match(FEAT_PREFIX);
    // ponytail: unrecognized text after the closing quote is kept as part of the title
    return feat ? { title, feat: feat[1] } : { title: `${title} ${after}` };
  }
  const feat = rest.match(TRAILING_FEAT);
  return feat ? { title: feat[1]!, feat: feat[2] } : { title: rest };
}

export function parseTracklist(text: string): ParsedTracklist {
  const tracks: Track[] = [];
  const bad: BadLine[] = [];
  let hour: Hour | null = null;
  const counts = { 1: 0, 2: 0 };

  text.split(/\r\n|\r|\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("# ")) return;
    const marker = line.match(HOUR_MARKER);
    if (marker) {
      hour = /^(1|one)$/i.test(marker[1]!) ? 1 : 2;
      return;
    }
    if (hour === null) {
      bad.push({ hour, line: i + 1, raw: line, reason: "before-hour-marker" });
      return;
    }
    const dash = line.match(SPACED_DASH);
    if (!dash || dash.index === undefined) {
      bad.push({ hour, line: i + 1, raw: line, reason: "no-separator" });
      return;
    }
    const artist = line.slice(0, dash.index).trim();
    const { title, feat } = splitTitle(line.slice(dash.index + dash[0].length).trim());
    counts[hour] += 1;
    tracks.push({ hour, position: counts[hour], artist, title, ...(feat ? { feat } : {}), raw: line, closing: false });
  });

  for (const h of [1, 2] as const) {
    const last = tracks.filter((t) => t.hour === h).at(-1);
    if (last) last.closing = true;
  }
  return { tracks, bad };
}

export function formatTrack(t: Pick<Track, "artist" | "title" | "feat">): string {
  return `${t.artist} - "${t.title}"${t.feat ? ` feat. ${t.feat}` : ""}`;
}
