"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { api } from "../../../../convex/_generated/api";
import { AudioIssues } from "@/components/AudioIssues";
import { Pill } from "@/components/Pill";
import { SampleTag } from "@/components/SampleTag";
import { backlogCount } from "@/lib/episodes";
import { Shell, useWorkspace } from "@/components/Shell";

const card = "rounded-card border border-line bg-surface p-5";
const heading = "text-base font-semibold";
const btn =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-control px-5 text-sm font-semibold";

const link = "font-medium underline underline-offset-2 hover:text-signal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Card({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className={card}>
      <div className="flex items-start justify-between gap-3">
        <h2 className={heading}>{title}</h2>
        {badge}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>;

export default function TodayPage() {
  const workspace = useWorkspace();
  const s = useQuery(api.today.summary);
  // Real workspace only (the query returns [] for anyone else), so demo never shows the card.
  const audioIssues = useQuery(api.media.issues, {});
  // Real workspace only too (null otherwise), so demo never shows the backlog line.
  const episodes = useQuery(api.episodes.list, {});
  const { isSignedIn } = useAuth();
  // Plan 8: the card counts the Bandcamp tab only; co-signs get their own line.
  const bandcampNew = s?.releases.byTab.bandcamp ?? 0;
  const bandcampItems = s?.releases.items.filter((r) => r.tab === "bandcamp") ?? [];

  return (
    <Shell title="Today">
      {s === undefined ? (
        <p className="text-ink-soft">Loading…</p>
      ) : s === null ? (
        <p className="text-ink-soft">
          {isSignedIn
            ? "This account can't use Air Check. Sign in with your Radio Milwaukee account."
            : "Sign in to see what is waiting for you."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="flex items-center gap-3 text-sm text-ink-soft">
            Since 6:00 pm yesterday
            {workspace === "demo" && <SampleTag />}
          </p>
          {episodes && (
            <p className="-mt-2 text-sm">
              <Link href="/episodes" className="font-medium underline underline-offset-2 hover:text-signal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal">
                Backlog: {plural(backlogCount(episodes.episodes), "show")} to go
              </Link>
            </p>
          )}
          <div className="grid items-start gap-5 min-[900px]:grid-cols-2">
            <div className="flex flex-col gap-5">
              <Card title="Ready to approve" badge={s.awaiting.length > 0 && <Pill tone="ready">{s.awaiting.length}</Pill>}>
                {s.awaiting.length === 0 ? (
                  <Empty>Nothing waiting for you.</Empty>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {s.awaiting.map((p) => (
                      <li key={p.packageId} className="flex flex-col gap-3">
                        <div>
                          <p className="font-semibold">{p.title}</p>
                          <p className="text-sm text-muted">
                            {plural(p.tracks, "track")} · {plural(p.flags, "flag")} for review
                          </p>
                        </div>
                        <Link href={`/packages/${p.packageId}`} className={`${btn} w-fit bg-signal text-white hover:bg-signal-deep`}>
                          Review
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <AudioIssues issues={audioIssues ?? undefined} />

              <Card
                title="Claims that failed verification"
                badge={s.openClaims.length > 0 && <Pill tone="caution">{s.openClaims.length} open</Pill>}
              >
                {s.openClaims.length === 0 ? (
                  <Empty>No open claims.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {s.openClaims.map((c, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0">
                        <span>{c.claim}</span>
                        <Pill tone={c.status === "conflict" ? "caution" : "problem"}>
                          {c.status === "conflict" ? "Sources disagree" : "Could not verify"}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card
                title="New Bandcamp releases"
                badge={bandcampNew > 0 && <Pill tone="ready">{bandcampNew} new</Pill>}
              >
                {bandcampNew === 0 ? (
                  <Empty>No new Bandcamp releases.</Empty>
                ) : (
                  // ponytail: the summary's two newest items can both be co-signs; then the count stands alone.
                  bandcampItems.length > 0 && <ul className="divide-y divide-line">
                    {bandcampItems.map((r) => (
                      <li key={`${r.artist}|${r.title}`} className="py-2.5 text-sm first:pt-0">
                        <p className="font-medium">
                          {r.artist} · {r.title}
                        </p>
                        <p className="text-muted">{[r.label, r.type].filter(Boolean).join(" · ")}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {s.releases.embargoed > 0 && (
                  // Plan 8: counted, never named here; the radar page (a private view) shows which.
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                    <Pill tone="caution">Embargoed</Pill>
                    {s.releases.embargoed === 1 ? "1 new release is embargoed, so it isn't named here." : `${s.releases.embargoed} new releases are embargoed, so they aren't named here.`}
                  </p>
                )}
                {s.releases.byTab.cosign > 0 && (
                  <p className="mt-3 text-sm">
                    <Link href="/release-radar?tab=cosign" className={link}>
                      {plural(s.releases.byTab.cosign, "new co-sign")}
                    </Link>
                  </p>
                )}
                <Link href="/release-radar" className={`${btn} mt-4 border border-line-strong bg-surface text-ink hover:bg-surface-quiet`}>
                  Open release radar
                </Link>
              </Card>
            </div>

            <div className="flex flex-col gap-5">
              <section className={`${card} ${s.blockedSince > 0 ? "border-problem-text/40" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className={heading}>
                    {s.blockedSince === 0 ? "Nothing blocked overnight" : `${plural(s.blockedSince, "request")} blocked overnight`}
                  </h2>
                  {s.blockedSince > 0 && <Pill tone="problem">Blocked</Pill>}
                </div>
                {s.blockedLatest && (
                  <p className="mt-3 text-sm text-ink-soft">
                    {s.blockedLatest.title}
                    {s.blockedLatest.destination && <span className="font-mono"> ({s.blockedLatest.destination})</span>}. It never left the sandbox.
                  </p>
                )}
                {s.blockedSince > 0 && (
                  <Link
                    href="/trust?filter=blocked"
                    className={`${btn} mt-4 border border-line-strong bg-surface text-ink hover:bg-surface-quiet`}
                  >
                    See audit log
                  </Link>
                )}
              </section>

              <Card title="Telegram summary">
                <div className="rounded-card border border-line bg-surface-quiet p-4 text-sm">
                  <p className="font-semibold">Air Check</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    <li>Ready to approve: {s.awaiting.length}</li>
                    <li>
                      Bandcamp: {plural(bandcampNew, "release")}, {plural(s.releases.labels.length, "label")}
                    </li>
                    <li>Verification: {plural(s.openClaims.length, "open item")}</li>
                    <li>Blocked overnight: {plural(s.blockedSince, "request")}</li>
                  </ul>
                </div>
                <p className="mt-3 text-sm text-muted">The link opens the signed-in console, where approvals happen.</p>
              </Card>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
