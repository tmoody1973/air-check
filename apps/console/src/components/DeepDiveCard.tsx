"use client";

import { type ArticleSentence, deepDiveArticle, LIMITS } from "@aircheck/core";
import { Fragment } from "react";
import { showDateLabel } from "@/lib/date";
import { embargoOf, isOpenClaim, type ResearchView, safeHref, trackName } from "@/lib/research";
import { VERIFY_CHIP } from "./ClaimLine";
import { Pill } from "./Pill";
import { type BlockActions, BlockControls, BlockPills } from "./ShowNotesCard";

// Plan 7 deep dive (job 8b), an article since Oct 30 (decision 023): a sourced brief, never a script. Core's
// deepDiveArticle shapes it (the Paper export renders the same structure); code counts the sourced facts ("Only N
// facts could be sourced" under 10), names each connection by its track (never a closing track), numbers references,
// and writes the past-shows line only for a count of 1 or more (R10: a zero cannot be known).

const TYPE_WORD = { artist: "Artist", label: "Label", release: "Release" } as const;
const SECTION_H = "font-serif text-[20px] leading-tight";
const CITE = "ml-px font-mono text-[10px] text-ink-soft no-underline hover:text-signal-deep focus-visible:outline-2 focus-visible:outline-signal";

/** One sentence: the text, a conflict's two versions, its citation numbers, then [verify] if it needs checking. */
function Sentence({ s }: { s: ArticleSentence }) {
  return (
    <span>
      <span>{s.text}</span>
      {s.conflict && <>{" "}<span className="text-caution-text">{s.conflict}</span></>}
      {s.refs.map((n) => <sup key={n}><a href={`#ref-${n}`} className={CITE}>{n}</a></sup>)}
      {s.verify && <>{" "}<span className={VERIFY_CHIP}>[verify]</span></>}
    </span>
  );
}

const Paragraph = ({ sentences }: { sentences: ArticleSentence[] }) => (
  <p className="[overflow-wrap:anywhere]">{sentences.map((s, i) => <Fragment key={i}>{i > 0 && " "}<Sentence s={s} /></Fragment>)}</p>
);

export function DeepDiveCard({ view, today, actions }: { view: ResearchView; today: string; actions: BlockActions }) {
  const subject = view.job.subject!;
  const brief = view.entries.find((e) => e.key === "brief");
  const a = deepDiveArticle({ subject, tracks: view.tracks, ...(brief && { entry: brief }) });
  const sourced = (brief && !brief.edited ? brief.claims : []).filter((c) => !isOpenClaim(c) && c.kind !== "connection" && c.kind !== "infobox").length;
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
        <div className="flow-root text-[15px] leading-[1.55]">
          {sourced < LIMITS.briefFactsMin && (
            <p className="mb-4 rounded-control bg-caution-bg px-3 py-2 text-sm text-caution-text">Only {sourced} {sourced === 1 ? "fact" : "facts"} could be sourced.</p>
          )}
          {a.infobox.length > 0 && (
            <aside aria-label={`${subject.name} at a glance`} className="mb-4 rounded-control border border-line bg-surface-quiet px-4 py-3 text-sm sm:float-right sm:mb-3 sm:ml-5 sm:w-64">
              <p className="mb-2 font-serif text-[17px] leading-tight [overflow-wrap:anywhere]">{subject.name}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                {a.infobox.map((r, i) => (
                  <Fragment key={i}>
                    <dt className="font-semibold">{r.field}</dt>
                    <dd className="[overflow-wrap:anywhere]"><Sentence s={r.value} /></dd>
                  </Fragment>
                ))}
              </dl>
            </aside>
          )}
          <div className="flex flex-col gap-4">
            {a.lead.length > 0 && <Paragraph sentences={a.lead} />}
            {a.sections.map((x) => (
              <section key={x.title} aria-labelledby={`dd-${x.title}`} className="flex flex-col gap-1.5">
                <h3 id={`dd-${x.title}`} className={SECTION_H}>{x.title}</h3>
                <Paragraph sentences={x.sentences} />
              </section>
            ))}
            {a.connects.length > 0 && (
              <section aria-labelledby="connects-h" className="flex flex-col gap-2 text-sm">
                <h3 id="connects-h" className={SECTION_H}>Connects to your list</h3>
                <ul className="flex flex-col gap-2.5">
                  {a.connects.map((c, i) => (
                    <li key={i} className="flex flex-col gap-1">
                      <span className="font-medium [overflow-wrap:anywhere]">{trackName(c.track)}</span>
                      <BlockPills embargo={embargoOf(c.track)} today={today} />
                      <p className="[overflow-wrap:anywhere]"><Sentence s={c.sentence} /></p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      {past && past.count > 0 && (
        <p className="border-t border-line pt-3 text-sm">
          On Rhythm Lab: {past.count} {past.count === 1 ? "show" : "shows"} in {past.year}{past.last ? `, last ${showDateLabel(past.last)}` : ""}
        </p>
      )}
      {brief && !brief.edited && (
        <>
          {a.unverified.length > 0 && (
            <section aria-labelledby="unverified-h" className="flex flex-col gap-2 text-sm">
              <h3 id="unverified-h" className={SECTION_H}>What I couldn&apos;t verify</h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 [overflow-wrap:anywhere]">
                {a.unverified.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </section>
          )}
          {brief.note && <p className="text-sm text-ink-soft [overflow-wrap:anywhere]"><span className="font-medium">Note: </span><span>{brief.note}</span></p>}
          {a.references.length > 0 && (
            <section aria-labelledby="refs-h" className="flex flex-col gap-2 border-t border-line pt-3 text-[13px]">
              <h3 id="refs-h" className={SECTION_H}>References</h3>
              <ol aria-labelledby="refs-h" className="flex list-decimal flex-col gap-1.5 pl-6 [overflow-wrap:anywhere]">
                {a.references.map((r) => {
                  const href = safeHref(r.url);
                  return (
                    <li key={r.n} id={`ref-${r.n}`} className="scroll-mt-4">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-ink underline underline-offset-2 hover:text-signal-deep">{r.title}</a>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      <span className="text-muted"> · {r.host}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      )}
      {brief && <BlockControls blockKey="brief" name="the brief" entry={brief} view={view} actions={actions} />}
    </article>
  );
}
