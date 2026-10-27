import { parseTracklist } from "../tracklist/parse";
import { checkDescription, type DescriptionIssue } from "./description";
import type { PackageDraft } from "./mixcloud";
import { buildTitle, checkTags, checkTitleArtists } from "./title";

export interface AgentPackageInput {
  showDate: string; // ISO yyyy-mm-dd
  tracklistText: string; // the raw tracklist, both hours
  leads: string[]; // title artists, in order
  tags: string[];
  description: string;
  hour1Id: string;
  hour2Id: string;
}

export type BuildResult = { ok: true; draft: PackageDraft } | { ok: false; problems: string[] };

function describeIssue(i: DescriptionIssue): string {
  switch (i.kind) {
    case "too-long":
      return `description is ${i.length} characters, must be under 1,000`;
    case "first-line":
      return "description must start with the standard first line";
    case "time-relative":
      return `description has a time-relative phrase: "${i.phrase}"`;
    case "tracklist":
      return `description lists tracks (${i.titles.join(", ")}); the tracklist belongs in sections`;
    case "private":
      return "description contains a private term";
  }
}

/** Compose the existing checks into one draft, or a list of problems. Never a partial draft. */
export function buildPackageDraft(input: AgentPackageInput, opts: { privateTerms: string[] }): BuildResult {
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
    showDate: input.showDate,
    trackTitles: tracks.map((t) => t.title),
    privateTerms: opts.privateTerms,
  }))
    problems.push(describeIssue(i));

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
      id: `pkg-${Number(date[2])}-${Number(date[3])}-${date[1]}`,
      workspace: "real",
      showDate: input.showDate,
      title,
      tags: [...input.tags],
      description: input.description,
      tracks,
      audio: { hour1Id: input.hour1Id, hour2Id: input.hour2Id },
    },
  };
}
