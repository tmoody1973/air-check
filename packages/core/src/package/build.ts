import { parseTracklist } from "../tracklist/parse";
import { checkDescription, type DescriptionIssue } from "./description";
import type { DescriptionSource, PackageDraft } from "./mixcloud";
import { buildTitle, checkTags, checkTitleArtists } from "./title";

export interface AgentPackageInput {
  showDate: string; // ISO yyyy-mm-dd
  tracklistText: string; // the raw tracklist, both hours
  leads: string[]; // title artists, in order
  tags: string[];
  description: string;
  descriptionSources?: DescriptionSource[]; // private: where each fact came from
  hour1Id: string;
  hour2Id: string;
}

export type BuildResult = { ok: true; draft: PackageDraft } | { ok: false; problems: string[] };

const MAX_SOURCES = 12;
const MAX_SOURCE_TEXT = 300;

/** Plain-message problems with the private source list; empty when fine or absent. */
function checkSources(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return ["descriptionSources must be a list"];
  if (v.length > MAX_SOURCES) return [`descriptionSources has ${v.length} entries, at most ${MAX_SOURCES}`];
  const out: string[] = [];
  v.forEach((e, i) => {
    for (const k of ["claim", "source"] as const) {
      const t = (e as Record<string, unknown> | null)?.[k];
      if (typeof t !== "string" || !t.trim()) out.push(`descriptionSources entry ${i + 1}: ${k} is empty`);
      else if ([...t].length > MAX_SOURCE_TEXT) out.push(`descriptionSources entry ${i + 1}: ${k} is over ${MAX_SOURCE_TEXT} characters`);
    }
  });
  return out;
}

function describeIssue(i: DescriptionIssue): string {
  switch (i.kind) {
    case "too-long":
      return `description is ${i.length} characters, must be under 1,000`;
    case "time-relative":
      return `description has a time-relative phrase: "${i.phrase}"`;
    case "tracklist":
      return `description lists tracks (${i.titles.join(", ")}); the tracklist belongs in sections`;
    case "private":
      return "description contains a private term";
  }
}

/**
 * Compose the existing checks into one draft, or a list of problems. Never a partial draft.
 * `idSuffix` (demo only) makes each demo draft's id unique: demo-M-D-YY-<suffix>. The caller supplies
 * the randomness so this stays pure. Real ids are always pkg-M-D-YY.
 */
export function buildPackageDraft(input: AgentPackageInput, opts: { privateTerms: string[]; workspace?: "real" | "demo"; idSuffix?: string }): BuildResult {
  const problems: string[] = [];
  const date = input.showDate.match(/^\d{2}(\d{2})-(\d{2})-(\d{2})$/);
  if (!date) return { ok: false, problems: [`showDate is not an ISO date: ${input.showDate}`] };
  const [y, m, d] = input.showDate.split("-").map(Number) as [number, number, number];
  if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== input.showDate)
    return { ok: false, problems: [`showDate is not a real date: ${input.showDate}`] };
  if (!input.hour1Id.trim()) problems.push("hour1Id is empty");
  if (!input.hour2Id.trim()) problems.push("hour2Id is empty");

  const { tracks, bad } = parseTracklist(input.tracklistText);
  for (const b of bad) problems.push(`tracklist line ${b.line} (${b.reason}): "${b.raw}"`);
  for (const h of [1, 2] as const) if (!tracks.some((t) => t.hour === h)) problems.push(`hour ${h} has no tracks`);

  input.leads.forEach((lead, i) => {
    if (!lead.trim()) problems.push(`title artist ${i + 1} is blank`);
  });
  for (const lead of checkTitleArtists(input.leads, tracks)) problems.push(`title artist not in the tracklist: ${lead}`);
  for (const p of checkTags(input.tags)) problems.push(`tags: ${p}`);
  for (const i of checkDescription(input.description, {
    trackTitles: tracks.map((t) => t.title),
    privateTerms: opts.privateTerms,
  }))
    problems.push(describeIssue(i));

  problems.push(...checkSources(input.descriptionSources));

  let title = "";
  try {
    title = buildTitle(input.showDate, input.leads);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  if (problems.length) return { ok: false, problems };

  return {
    ok: true,
    draft: {
      id: opts.workspace === "demo"
        ? `demo-${Number(date[2])}-${Number(date[3])}-${date[1]}${opts.idSuffix ? `-${opts.idSuffix}` : ""}`
        : `pkg-${Number(date[2])}-${Number(date[3])}-${date[1]}`,
      workspace: opts.workspace ?? "real",
      showDate: input.showDate,
      title,
      tags: [...input.tags],
      description: input.description,
      ...(input.descriptionSources && { descriptionSources: input.descriptionSources.map((e) => ({ claim: e.claim, source: e.source })) }),
      tracks,
      audio: { hour1Id: input.hour1Id, hour2Id: input.hour2Id },
    },
  };
}
