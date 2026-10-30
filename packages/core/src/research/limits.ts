/** Plan 7 research limits. One place, so the bridge, Convex and the prompt agree. */
export const LIMITS = {
  claimsPerBlock: 12,
  sourcesPerClaim: 4,
  /** P3: the bridge refuses a block citing more, so the post stays under the research route's body cap (RESEARCH_BODY_BYTES). */
  sourcesPerBlock: 40,
  claim: 300,
  intro: 600,
  angle: 140,
  note: 300,
  replacement: 600,
  deepDiveFactsMin: 5,
  deepDiveFactsMax: 8,
  connectsMax: 3,
  /** A source's text the ledger keeps for code's fact check: Tavily's chunks plus the page's plain text (Oct 29). */
  sourceText: 8_000,
  /** The ingest service's MAX_NOTES_BYTES. */
  verifyNotesBytes: 65_536,
  searchResults: 5,
  searchQuery: 300,
} as const;

export const MAX_CONTINUATIONS = 3;
/**
 * Daily web source_search caps per America/Chicago day. Tavily pay-as-you-go since Oct 29; an advanced search is 2
 * credits, so a full real day is 200 credits and a full demo day 40.
 */
export const SEARCH_CAP = { real: 100, demo: 20 } as const;
export const SEARCH_CAP_REACHED = "Daily research limit reached; finish with what you have, mark the rest could-not-verify.";
