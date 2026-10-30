const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Plain-text "ready for review" message. Review link only: approval happens in the signed-in console. */
export function readyCard(p: { title: string; trackCount: number; flagCount: number; packageId: string; appUrl: string }): string {
  const base = p.appUrl.replace(/\/+$/, "");
  return [p.title, `${plural(p.trackCount, "track")} · ${plural(p.flagCount, "flag")}`, `Review package: ${base}/packages/${p.packageId}`].join("\n");
}

/**
 * Plan 7: a finished pre-air check. The show, two counts and a link to the signed-in console only: never the report's
 * text, so nothing private or embargoed reaches Telegram, and nothing is decided there.
 */
export function researchCard(p: { jobId: string; showDate: string; changes: number; open: number; appUrl: string }): string {
  const base = p.appUrl.replace(/\/+$/, "");
  const [y, m, d] = p.showDate.split("-");
  return [`Pre-air verify · ${Number(m)}-${Number(d)}-${y!.slice(2)}`, `${plural(p.changes, "change")} · ${p.open} open`, `Open report: ${base}/research/${p.jobId}`].join("\n");
}
