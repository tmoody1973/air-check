"use client";

import { LIMITS } from "@aircheck/core";
import { showDateLabel } from "@/lib/date";
import { isOpenClaim, type ResearchView, trackName } from "@/lib/research";
import { ClaimLine } from "./ClaimLine";
import { Pill } from "./Pill";
import { type BlockActions, BlockControls, BlockPills, Claims } from "./ShowNotesCard";

// Plan 7 deep dive (job 8b): a sourced brief, never a script. Code counts the sourced facts ("Only N facts could be
// sourced" under 5, ruling M8), names each connection by its track (never a closing track), and writes the past-shows
// line only for a count of 1 or more (R10: a zero cannot be known).

const TYPE_WORD = { artist: "Artist", label: "Label", release: "Release" } as const;
const MIN_FACTS = 5;

export function DeepDiveCard({ view, today, actions }: { view: ResearchView; today: string; actions: BlockActions }) {
  const subject = view.job.subject!;
  const brief = view.entries.find((e) => e.key === "brief");
  const claims = brief && !brief.edited ? brief.claims : [];
  const facts = claims.filter((c) => !isOpenClaim(c) && c.kind !== "connection");
  const sourced = facts.filter((c) => c.status === "confirmed" || c.status === "sourced").length;
  const tracks = new Map(view.tracks.filter((t) => !t.closing).map((t) => [t.key, t]));
  const connects = claims
    .filter((c) => !isOpenClaim(c) && c.kind === "connection" && c.value !== undefined && tracks.has(c.value))
    .slice(0, LIMITS.connectsMax);
  const unverified = claims.filter(isOpenClaim);
  const past = view.pastShows;

  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-serif text-[26px] leading-tight [overflow-wrap:anywhere]">{subject.name}</h2>
          <Pill tone="neutral">{TYPE_WORD[subject.type]}</Pill>
        </div>
        <BlockPills entry={brief} embargo={view.subjectEmbargo} today={today} />
      </header>

      {!brief ? (
        <p className="text-sm text-muted">No brief yet.</p>
      ) : brief.edited ? (
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{brief.edited.text}</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          {sourced < MIN_FACTS && <p className="rounded-control bg-caution-bg px-3 py-2 text-caution-text">Only {sourced} {sourced === 1 ? "fact" : "facts"} could be sourced.</p>}
          <Claims claims={facts} />
          {connects.length > 0 && (
            <section aria-labelledby="connects-h" className="flex flex-col gap-2">
              <h3 id="connects-h" className="font-semibold">Connects to your list</h3>
              <ul className="flex flex-col gap-2.5">
                {connects.map((c, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <span className="font-medium [overflow-wrap:anywhere]">{trackName(tracks.get(c.value!)!)}</span>
                    <ClaimLine claim={c} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {unverified.length > 0 && (
            <section aria-labelledby="unverified-h" className="flex flex-col gap-2">
              <h3 id="unverified-h" className="font-semibold">Could not verify</h3>
              <Claims claims={unverified} />
            </section>
          )}
          {brief.note && <p className="text-ink-soft [overflow-wrap:anywhere]"><span className="font-medium">Note: </span><span>{brief.note}</span></p>}
        </div>
      )}

      {past && past.count > 0 && (
        <p className="border-t border-line pt-3 text-sm">
          On Rhythm Lab: {past.count} {past.count === 1 ? "show" : "shows"} in {past.year}{past.last ? `, last ${showDateLabel(past.last)}` : ""}
        </p>
      )}
      {brief && <BlockControls blockKey="brief" name="the brief" entry={brief} view={view} actions={actions} />}
    </article>
  );
}
