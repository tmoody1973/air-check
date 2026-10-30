/** Plan 7 research limits. One place, so the bridge, Convex and the prompt agree. */
export const LIMITS = {
  claimsPerBlock: 12,
  sourcesPerClaim: 4,
  /** P3: the bridge refuses a block citing more, so the post stays under Convex's 131,072-byte body cap. */
  sourcesPerBlock: 40,
  claim: 300,
  intro: 600,
  angle: 140,
  note: 300,
  replacement: 600,
  deepDiveFactsMin: 5,
  deepDiveFactsMax: 8,
  connectsMax: 3,
  sourceText: 2_000,
  /** The ingest service's MAX_NOTES_BYTES. */
  verifyNotesBytes: 65_536,
  searchResults: 5,
  searchQuery: 300,
} as const;

export const MAX_CONTINUATIONS = 3;
/** Daily source_search caps per America/Chicago day (Free Tavily plan, about 1,000 credits a month). */
export const SEARCH_CAP = { real: 30, demo: 10 } as const;
export const SEARCH_CAP_REACHED = "Daily research limit reached; finish with what you have, mark the rest could-not-verify.";
