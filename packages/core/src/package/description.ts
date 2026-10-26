const MAX_DESCRIPTION = 999; // "under 1,000 characters", counted in code points
const TRACKLIST_THRESHOLD = 3;
const MIN_TITLE_LENGTH = 5;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH = MONTHS.join("|");

const TIME_RELATIVE = [
  /\bout (?:today|now|this week|next week|tomorrow)\b/gi,
  /\b(?:this|next) (?:friday|week|weekend|month)\b/gi,
  /\b(?:today|tomorrow|tonight|yesterday)\b/gi,
  new RegExp(`\\b(?:coming|out|arrives|drops|due)(?: on)? (?:${MONTH}) \\d{1,2}\\b`, "gi"),
  /\bupcoming\b/gi,
  /\bjust (?:dropped|released|announced)\b/gi,
];

export type DescriptionIssue =
  | { kind: "too-long"; length: number }
  | { kind: "first-line" }
  | { kind: "time-relative"; phrase: string }
  | { kind: "tracklist"; titles: string[] }
  | { kind: "private"; term: string };

function firstLine(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `Rhythm Lab Radio, week of ${MONTHS[m! - 1]} ${d}, ${y}, hosted by Tarik Moody and produced by Radio Milwaukee.`;
}

/** Public-description rules from skills/rlr-description-safety. Returns every problem found. */
export function checkDescription(
  text: string,
  opts: { showDate: string; trackTitles: string[]; privateTerms: string[] },
): DescriptionIssue[] {
  const issues: DescriptionIssue[] = [];
  const length = [...text].length;
  if (length > MAX_DESCRIPTION) issues.push({ kind: "too-long", length });
  if (!text.startsWith(firstLine(opts.showDate))) issues.push({ kind: "first-line" });
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
