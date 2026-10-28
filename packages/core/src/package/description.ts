const MAX_DESCRIPTION = 999; // "under 1,000 characters", counted in code points
const TRACKLIST_THRESHOLD = 6;
const MIN_TITLE_LENGTH = 5;
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";

const TIME_RELATIVE = [
  /\bout (?:today|now|this week|next week|tomorrow)\b/gi,
  /\b(?:this|next) (?:friday|week|weekend|month)\b/gi,
  /\bthis week['’]s(?: show)?/gi,
  /\b(?:today|tomorrow|tonight|yesterday)\b/gi,
  new RegExp(`\\b(?:coming|out|arrives|drops|due)(?: on)? (?:${MONTH}) \\d{1,2}\\b`, "gi"),
  /\bupcoming\b/gi,
  /\bjust (?:dropped|released|announced)\b/gi,
];

export type DescriptionIssue =
  | { kind: "too-long"; length: number }
  | { kind: "time-relative"; phrase: string }
  | { kind: "tracklist"; titles: string[] }
  | { kind: "private"; term: string };

/** Public-description rules from skills/rlr-description-safety. Returns every problem found. */
export function checkDescription(
  text: string,
  opts: { trackTitles: string[]; privateTerms: string[] },
): DescriptionIssue[] {
  const issues: DescriptionIssue[] = [];
  const length = [...text].length;
  if (length > MAX_DESCRIPTION) issues.push({ kind: "too-long", length });
  for (const re of TIME_RELATIVE)
    for (const m of text.matchAll(re)) issues.push({ kind: "time-relative", phrase: m[0] });
  const lower = text.toLowerCase();
  const titles = [...new Set(opts.trackTitles.filter((t) => t.length >= MIN_TITLE_LENGTH))].filter((t) =>
    lower.includes(t.toLowerCase()),
  );
  if (titles.length >= TRACKLIST_THRESHOLD) issues.push({ kind: "tracklist", titles });
  for (const term of opts.privateTerms)
    if (term && lower.includes(term.toLowerCase())) issues.push({ kind: "private", term });
  return issues;
}
