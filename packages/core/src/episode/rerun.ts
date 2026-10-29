import { normalize } from "../tracklist/normalize";
import { isShowDate } from "./dates";
import type { EpisodeFacts } from "./status";

const OVERLAP = 0.8;
const key = (t: { artist: string; title: string }) => `${normalize(t.artist)}|${normalize(t.title)}`;

/** A hint only: the caller turns it into the question "Is <date> a rerun of <date>?". Never decides. */
export function rerunCandidate(e: EpisodeFacts, earlier: EpisodeFacts[]): { of: string; reason: string } | null {
  if (e.rerunOf || e.rerunDeclined) return null;

  const mine = new Set((e.tracks ?? []).map(key));
  if (mine.size > 0) {
    let best: { of: string; share: number } | null = null;
    for (const o of [...earlier].sort((a, b) => a.showDate.localeCompare(b.showDate))) {
      if (o.showDate >= e.showDate) continue;
      const theirs = new Set((o.tracks ?? []).map(key));
      const share = [...mine].filter((k) => theirs.has(k)).length / mine.size;
      if (share >= OVERLAP && (!best || share > best.share)) best = { of: o.showDate, share };
    }
    if (best) return { of: best.of, reason: `${Math.round(best.share * 100)}% of the tracks match the ${best.of} show.` };
  }
  if (e.stampDate && isShowDate(e.stampDate) && e.stampDate < e.showDate)
    return { of: e.stampDate, reason: `The audio files are stamped ${e.stampDate}.` };
  if (e.docTitle && /\(evergreen\)/i.test(e.docTitle))
    return { of: "", reason: "The Drive doc title says (evergreen)." };
  return null;
}
