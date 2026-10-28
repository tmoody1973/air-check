const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Plain-text "ready for review" message. Review link only: approval happens in the signed-in console. */
export function readyCard(p: { title: string; trackCount: number; flagCount: number; packageId: string; appUrl: string }): string {
  const base = p.appUrl.replace(/\/+$/, "");
  return [p.title, `${plural(p.trackCount, "track")} · ${plural(p.flagCount, "flag")}`, `Review package: ${base}/packages/${p.packageId}`].join("\n");
}
