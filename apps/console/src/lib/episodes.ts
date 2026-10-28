// The Episodes page's plain arithmetic: blank Fridays, the summary line, the backlog count, download errors in words.
// All computed from the rows Convex returns, never invented (Plan 6 Task 5).

type Countable = { status: string; gaps: readonly string[]; questions: readonly { answer?: string }[] };

const DONE = new Set(["published", "rerun", "skipped"]);
/** Still to clear: not on Mixcloud, not a rerun (reruns are never posted), not skipped. */
export const inBacklog = (r: { status: string }) => !DONE.has(r.status);
export const backlogCount = (rows: readonly { status: string }[]) => rows.filter(inBacklog).length;

/**
 * Every Friday from Jan 2, 2026 up to and including `today` (a Chicago yyyy-mm-dd key) that has no episode row.
 * UTC calendar math, so daylight saving never skips or doubles a week.
 */
export function blankFridays(showDates: Iterable<string>, today: string): string[] {
  const have = new Set(showDates);
  const out: string[] = [];
  for (let ms = Date.UTC(2026, 0, 2); ; ms += 7 * 86_400_000) {
    const key = new Date(ms).toISOString().slice(0, 10);
    if (key > today) return out;
    if (!have.has(key)) out.push(key);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "31 shows · 4 missing audio · 2 missing notes · 7 blank Fridays · 3 questions · 2 reruns". Gaps count unfinished shows only. */
export function summaryLine(rows: readonly Countable[], blanks: number): string {
  const open = rows.filter(inBacklog);
  const gap = (g: string) => open.filter((r) => r.gaps.includes(g)).length;
  const questions = open.reduce((n, r) => n + r.questions.filter((q) => !q.answer).length, 0);
  const reruns = rows.filter((r) => r.status === "rerun").length;
  const parts = [
    plural(rows.length - reruns, "show"),
    gap("audio") && `${gap("audio")} missing audio`,
    gap("tracklist") && plural(gap("tracklist"), "missing tracklist"),
    gap("notes") && `${gap("notes")} missing notes`,
    blanks && plural(blanks, "blank Friday"),
    questions && plural(questions, "question"),
    reruns && plural(reruns, "rerun"),
  ];
  return parts.filter(Boolean).join(" · ");
}

const FETCH: Record<string, string> = {
  too_large: "the file is bigger than Air Check allows",
  size_mismatch: "the file arrived at the wrong size",
  not_ready: "Box wasn't ready to send it",
  bad_redirect: "Box sent it from an unexpected address",
  bad_id: "Box gave an unusable file id",
};

/** The ingest service's short download code in plain words. An unknown code is never echoed. */
export function fetchErrorText(code: string | undefined): string {
  if (code && Object.hasOwn(FETCH, code)) return FETCH[code]!;
  const http = /^http_(\d{3})$/.exec(code ?? "")?.[1];
  if (http === "404") return "Box couldn't find the file";
  if (http === "401" || http === "403") return "Box refused access";
  if (http?.startsWith("5")) return "Box had a server problem";
  return "the connection dropped or Box refused";
}
