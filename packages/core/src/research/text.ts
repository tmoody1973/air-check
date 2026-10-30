import { LIMITS } from "./limits";

export type ResearchTextWhere = "claim" | "intro" | "angle" | "note" | "replacement";

// Straight or curly apostrophes, since the model writes both.
const TALK = /\b(you[’']?re listening|stay tuned|coming up|up next|right here on|welcome (back )?to|thanks for listening|let[’']?s (hear|listen|go)|on the air tonight|next up|tune in|stick around)\b/i;
// A bare domain with a path (example.org/x) is a link too.
const LINK = /https?:\/\/|www\.|\b[\w-]+\.[a-z]{2,}\//i;
const PERSON = /\b(i|i[’']m|me|my|we|our|you|your)\b/i;
const MAX: Record<ResearchTextWhere, number> = { claim: LIMITS.claim, intro: LIMITS.intro, angle: LIMITS.angle, note: LIMITS.note, replacement: LIMITS.replacement };

/** Null when model text may be saved; else a plain reason the agent can act on (Hard Rule 7: research, never talk). */
export function checkResearchText(text: string, where: ResearchTextWhere): string | null {
  if (text.length > MAX[where]) return `Too long: a ${where} is at most ${MAX[where]} characters.`;
  const talk = text.match(TALK);
  if (talk) return `Reads as on-air talk ("${talk[0]}"). Air Check writes research, never scripts or talk.`;
  if (LINK.test(text)) return "Contains a link. Cite [S…] ids instead; Air Check adds the links.";
  if (where === "angle") {
    const person = text.match(PERSON);
    if (person) return `An angle is a question or connection, not first or second person ("${person[0]}").`;
    if (text.includes("!")) return "An angle has no exclamation marks (!).";
  }
  return null;
}
