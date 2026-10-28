// Pure helpers for the chat screen: step wording and plain-language send errors.

// First match wins. Tool names look like `mcp__crate__musicbrainz_search_artist`.
const STEP_NAMES: readonly (readonly [string, string])[] = [
  ["musicbrainz_", "Searching MusicBrainz"],
  ["wikipedia_", "Reading Wikipedia"],
  ["bandcamp_", "Searching Bandcamp"],
  ["itunes_", "Searching iTunes"],
  ["package_submit", "Submitting the package"],
  ["package_revise", "Revising the description"],
  ["package_get", "Reading the package"],
];

export function stepName(tool: string): string {
  return STEP_NAMES.find(([key]) => tool.includes(key))?.[1] ?? "Working";
}

/** One compact line for a run that is still going; null once it has finished. */
export function progressLine(status: string, steps: readonly { tool: string }[]): string | null {
  if (status === "queued") return "Waiting for the agent…";
  if (status !== "running") return null;
  const last = steps[steps.length - 1];
  return last ? `${stepName(last.tool)} · step ${steps.length}` : "Working…";
}

export const MAX_MESSAGE_CHARS = 8_000;

const GENERIC = "Couldn't send. Please try again.";
const MESSAGES: Record<string, string> = {
  RATE_LIMITED: "Demo limit reached. Your message wasn't sent; try again in a few minutes.",
  INVALID_INPUT: "Messages can be up to 8,000 characters.",
  NOT_FOUND: "That conversation is gone.",
  UNAUTHENTICATED: "Signing you in… try again in a moment.",
};

/** ConvexError carries `{ code }` in `.data`. Unknown codes (and `constructor`) get the generic line; detail goes to the console. */
export function chatErrorText(e: unknown): string {
  console.error("chat.send failed", e);
  const code = (e as { data?: { code?: unknown } } | null)?.data?.code;
  return typeof code === "string" && Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : GENERIC;
}
