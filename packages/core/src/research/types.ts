import type { ActiveEmbargo } from "../radar/embargo";

export type ResearchKind = "show-notes" | "verify" | "deep-dive";
export type ClaimKind = "release" | "release-date" | "label" | "credit" | "track-number" | "length" | "bio" | "detail" | "thread" | "connection";
/** The two-source rule: these need two publishers or one primary, non-aggregator source. */
export const CRITICAL_KINDS: readonly ClaimKind[] = ["release-date", "label", "credit"];
/** The source's own text must show the value. */
export const VALUE_KINDS: readonly ClaimKind[] = ["release", "release-date", "label", "credit", "track-number", "length"];
/** `sourced` = a non-critical fact with at least one source. `[verify]` = `conflict` or `could-not-verify`. */
export type ClaimStatus = "confirmed" | "sourced" | "conflict" | "could-not-verify";

/** A source the bridge issued an id for. `via` is "tavily", "apple_music" or "crate:<tool>"; `text` is for matching only, never stored. */
export interface ResolvedSource { url: string; host: string; title: string; via: string; text: string }
/** A claim as the agent submits it: sources by id only. For a `connection`, `value` is the track key it connects to. */
export interface ClaimInput { kind: ClaimKind; text: string; value?: string; sources: { id: string; says?: string; primary?: boolean }[] }
export interface CitedSource { url: string; host: string; title: string; via: string; says?: string; primary: boolean; matched: boolean }
/** `check` is code-written: what to check, for a `[verify]` claim. */
export interface JudgedClaim { kind: ClaimKind; text: string; value?: string; status: ClaimStatus; sources: CitedSource[]; check?: string }

export interface ResearchTrack { key: string; hour: 1 | 2; position: number; artist: string; title: string; feat?: string; closing: boolean }
export interface NoteLine { id: string; text: string; trackKey?: string; closing: boolean }

/** Filled at read time from Plan 8's activeEmbargoes(); never stored. `until: null` = active, date not known. */
export interface EmbargoMark { until: string | null }
export type ViewTrack = ResearchTrack & { embargo?: EmbargoMark };

/**
 * One saved block as the views read it (a `researchEntries` row, stale ones left out by the caller). Keys:
 * `H<n>.<p>` (claims, angle, note, private, suppliedNote), `H<n>.intro` (intro), `H<n>.threads` (claims),
 * `L<n>` (claims, replacement), `brief` (claims, note). `edited` is Tarik's text, shown in place of the block.
 */
export interface ResearchEntry {
  key: string;
  claims: JudgedClaim[];
  intro?: string;
  angle?: string;
  note?: string;
  replacement?: string;
  private?: { by: "agent" | "tarik"; reason?: string };
  suppliedNote?: string;
  edited?: { text: string };
}

/** `embargoes` = activeEmbargoes() for today: marks tracks (with or instead of `track.embargo`) and screens prose. */
export interface ShowNotesView { showDate: string; angles: boolean; tracks: ViewTrack[]; entries: ResearchEntry[]; embargoes?: ActiveEmbargo[] }
/** `tracks` with their embargo marks are for the card's pills; verifyReport reads lines and entries. */
export interface VerifyView { lines: NoteLine[]; entries: ResearchEntry[]; tracks?: ViewTrack[] }
/** `pastShows` comes from code (play history): "On Rhythm Lab: N shows in <year>, last <date>"; absent or 0 = no line (R10). */
export interface DeepDiveView {
  subject: { type: "artist" | "label" | "release"; name: string };
  embargo?: EmbargoMark;
  tracks: ViewTrack[];
  entry?: ResearchEntry;
  pastShows?: { count: number; year: number; last?: string };
}
