import type { JudgedClaim } from "@aircheck/core";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { embargoLabel } from "../components/ReleaseItem";

// Plan 7: shared reads for the research screens. Every count, date and label here is computed in code from Convex rows
// (Hard Rule 10); the model's sentences are only ever passed through as plain text.

export type ResearchView = NonNullable<FunctionReturnType<typeof api.research.get>>;
export type ResearchEntryRow = ResearchView["entries"][number];
export type ResearchTrackRow = ResearchView["tracks"][number];
/** A track's active embargo from research.get (only embargoed tracks carry the field). */
export const embargoOf = (t: ResearchTrackRow | undefined): { until: string | null } | undefined => (t && "embargo" in t ? t.embargo : undefined);
export type ResearchKind = ResearchView["job"]["kind"];
export type ResearchStatus = ResearchView["job"]["status"];
export type Embargo = { until: string | null };

export const isOpenClaim = (c: JudgedClaim) => c.status === "conflict" || c.status === "could-not-verify";
export const isActive = (s: ResearchStatus) => s === "queued" || s === "running";
/** A block the agent saved or Tarik edited: not researched again (Convex `isDone`). */
export const isDoneEntry = (e: ResearchEntryRow | undefined) => !!e && (e.savedAt !== undefined || e.edited !== undefined);
/** Seeded demo jobs never had a run; every real or visitor job has at least one. */
export const isSample = (v: ResearchView) => v.job.runIds.length === 0;

export const trackName = (t: { artist: string; title: string; feat?: string }) => `${t.artist} – “${t.title}”${t.feat ? ` feat. ${t.feat}` : ""}`;

/** "2026-10-02" -> "10.2.26", the way Tarik writes show dates. */
export function shortDate(iso: string | undefined): string {
  const m = /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${Number(m[2])}.${Number(m[3])}.${m[1]}` : "";
}

export function pageTitle(v: ResearchView): string {
  const date = shortDate(v.job.showDate);
  if (v.job.kind === "show-notes") return `Show notes, ${date}`;
  if (v.job.kind === "verify") return `Pre-air check, ${date}`;
  return `Deep dive: ${v.job.subject?.name ?? ""}`;
}

/** "RLR-10-30-26-show-notes.md" (the fixtures' date style). */
export function exportFileName(v: ResearchView): string {
  const m = /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(v.job.showDate ?? "");
  const date = m ? `${Number(m[2])}-${Number(m[3])}-${m[1]}` : "";
  if (v.job.kind === "show-notes") return `RLR-${date}-show-notes.md`;
  if (v.job.kind === "verify") return `RLR-${date}-pre-air-check.md`;
  const slug = (v.job.subject?.name ?? "subject").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "subject";
  return `deep-dive-${slug}.md`;
}

/** The pill words for an embargoed block: Plan 8's wording, or null once lifted. */
export const embargoWords = (embargo: Embargo | undefined, today: string) => embargoLabel(embargo, today);

/** Only http(s) ever becomes a link. */
export const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

export const STATUS_PILL: Record<ResearchStatus, ["ready" | "caution" | "problem" | "neutral", string]> = {
  queued: ["neutral", "Queued"],
  running: ["neutral", "Working"],
  "taken-over": ["neutral", "Taken over"],
  done: ["ready", "Done"],
  stopped: ["neutral", "Stopped"],
  failed: ["problem", "Failed"],
};

export const KIND_WORD: Record<ResearchKind, string> = { "show-notes": "Show notes", verify: "Pre-air check", "deep-dive": "Deep dive" };

/** "about 3 min left", never under one minute. */
export const timeLeft = (seconds: number) => `about ${Math.max(1, Math.round(seconds / 60))} min left`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The progress numbers the card shows: tracks for show notes, lines for a check, the brief for a deep dive. */
export function progressOf(v: ResearchView): { done: number; total: number; line: string } {
  const byKey = new Map(v.entries.map((e) => [e.key, e]));
  if (v.job.kind === "show-notes") {
    const open = v.tracks.filter((t) => !t.closing);
    const done = open.filter((t) => isDoneEntry(byKey.get(t.key))).length;
    const skipped = v.tracks.length - open.length;
    return { done, total: open.length, line: `${done} of ${plural(open.length, "track")} · ${plural(skipped, "closing track")} skipped` };
  }
  if (v.job.kind === "verify") {
    const lines = v.job.lines ?? [];
    const skipped = lines.filter((l) => l.closing).length;
    const { done, total } = v.progress;
    return { done, total, line: `${done} of ${plural(total, "line")} checked · ${plural(skipped, "line")} under closing tracks skipped` };
  }
  const { done, total } = v.progress;
  return { done, total, line: done >= total ? "Brief written" : "Writing the brief" };
}

/** Plain words for a refused start or steer: a ConvexError's own message, else a generic line (never raw server text). */
export function refusalText(e: unknown): string {
  const data = (e as { data?: { message?: unknown; code?: unknown } } | null)?.data;
  if (typeof data?.message === "string") return data.message;
  if (data?.code === "UNAUTHENTICATED") return "Signing you in… try again in a moment.";
  if (data?.code === "NOT_FOUND") return "That research job no longer exists.";
  return "That didn't work. Try again.";
}
export const codeOf = (e: unknown) => (e as { data?: { code?: unknown } } | null)?.data?.code;
