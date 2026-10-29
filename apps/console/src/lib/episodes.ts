// The Episodes page's plain arithmetic: blank Fridays, the summary line, the backlog count, download errors in words.
// All computed from the rows Convex returns, never invented (Plan 6 Task 5).

type Countable = { status: string; gaps: readonly string[]; questions: readonly { answer?: string }[] };

const DONE = new Set(["published", "rerun", "skipped", "not-in-backlog"]);
/** Still to clear: not on Mixcloud, not a rerun (reruns are never posted), not skipped, not a removed 2025 date. */
export const inBacklog = (r: { status: string }) => !DONE.has(r.status);
export const backlogCount = (rows: readonly { status: string }[]) => rows.filter(inBacklog).length;

const DAY = 86_400_000;
/** The Friday on or after a yyyy-mm-dd date: the Friday a show dated in the 7 days ending on it covers. */
function coveringFriday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y!, m! - 1, d!);
  return new Date(ms + ((5 - new Date(ms).getUTCDay() + 7) % 7) * DAY).toISOString().slice(0, 10);
}

/**
 * Every Friday from Jan 2, 2026 up to and including `today` (a Chicago yyyy-mm-dd key) with no show dated in the
 * 7 days ending on it (an off-Friday date still covers its week). UTC calendar math, so DST never skips a week.
 */
export function blankFridays(showDates: Iterable<string>, today: string): string[] {
  const have = new Set([...showDates].map(coveringFriday));
  const out: string[] = [];
  for (let ms = Date.UTC(2026, 0, 2); ; ms += 7 * DAY) {
    const key = new Date(ms).toISOString().slice(0, 10);
    if (key > today) return out;
    if (!have.has(key)) out.push(key);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Column = "audio" | "tracklist" | "notes";
const NOT_CONNECTED: Record<Column, string> = { audio: "audio not connected", tracklist: "tracklists not connected", notes: "notes not connected" };

/**
 * "31 shows · 4 missing audio · 2 missing notes · 7 blank Fridays · 3 questions · 2 reruns". Gaps count unfinished
 * shows only. A column whose source isn't connected shows a dash, so it is named once ("notes not connected"), not counted.
 */
export function summaryLine(rows: readonly Countable[], blanks: number, notConnected: readonly Column[] = []): string {
  const open = rows.filter(inBacklog);
  const count = (g: Column) => open.filter((r) => r.gaps.includes(g)).length;
  const gap = (g: Column, words: (n: number) => string) => (notConnected.includes(g) ? NOT_CONNECTED[g] : count(g) && words(count(g)));
  const questions = open.reduce((n, r) => n + r.questions.filter((q) => !q.answer).length, 0);
  const reruns = rows.filter((r) => r.status === "rerun").length;
  const removed = rows.filter((r) => r.status === "not-in-backlog").length;
  const parts = [
    plural(rows.length - reruns - removed, "show"),
    gap("audio", (n) => `${n} missing audio`),
    gap("tracklist", (n) => plural(n, "missing tracklist")),
    gap("notes", (n) => `${n} missing notes`),
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

const CORRECTED_WORDS = {
  tracklist: "tracklist",
  drive: "which Drive doc",
  paper: "which Paper doc",
  box: "which Box folder",
  hours: "which files are Hour 1 and Hour 2",
  folderDate: "the show date",
} as const;

/** "tracklist, which Paper doc": what Tarik's saved fix covers, in the order Convex sends it. */
export const correctedText = (fields: readonly (keyof typeof CORRECTED_WORDS)[]) => fields.map((f) => CORRECTED_WORDS[f]).join(", ");

/** Where an undated name was found, in words. */
export const SOURCE_NAME = { box: "Box", drive: "Google Drive", paper: "Dropbox Paper" } as const;
