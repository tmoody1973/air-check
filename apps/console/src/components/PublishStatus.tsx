import type { PackageRecord } from "@aircheck/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { chicagoTimeLabel, dayKeyLabel } from "../lib/date";

/** packages.publishState's answer, plus the Chicago day key (`today`) it was asked for, so count and label agree. */
export type PublishState = { dayOffset: number | null; mixcloudState: "connected" | "needs_reconnect" | "not_connected"; today: string };

const MIXCLOUD = "https://www.mixcloud.com/";
/** A receipt URL becomes a link only on Mixcloud's own site; anything else is shown as text. */
export const isMixcloudUrl = (url: string | undefined): url is string => !!url?.startsWith(MIXCLOUD);

const LINK = "font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const TONE = {
  ready: "bg-signal-soft text-signal-deep",
  caution: "bg-caution-bg text-caution-text",
  problem: "bg-problem-bg text-problem-text",
  quiet: "bg-surface-quiet text-ink-soft",
} as const;

function Banner({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <div role="status" className={`rounded-control px-4 py-3 text-sm [overflow-wrap:anywhere] ${TONE[tone]}`}>{children}</div>;
}

function queuedText({ dayOffset, today }: PublishState): string {
  if (dayOffset === null) return "Queued, but it can't post until it has a cover.";
  // ponytail: "posts on <date>" names the day it should go up, from the same 3-a-day order the publisher uses.
  return dayOffset === 0 ? "Queued: posts today" : `Queued: posts on ${dayKeyLabel(today, dayOffset)} (3 a day, oldest first)`;
}

/** Where a decided real package stands with Mixcloud: queued, uploading, the receipt, or what went wrong. */
export function PublishStatus({ record, publish, mixcloudAccount }: {
  record: PackageRecord;
  publish?: PublishState | null;
  mixcloudAccount?: string;
}) {
  const { result } = record;
  switch (record.status) {
    case "approved":
      if (!publish) return null;
      return publish.mixcloudState === "connected" ? (
        <Banner tone="ready">{queuedText(publish)}</Banner>
      ) : (
        <Banner tone="caution">
          <Link href="/settings" className={LINK}>Connect Mixcloud to publish</Link>. The show waits in the queue until then.
        </Banner>
      );
    case "publishing":
      return <Banner tone="quiet">Uploading to Mixcloud…</Banner>;
    case "succeeded":
      return (
        <section aria-label="Mixcloud receipt" className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-base font-semibold">Posted to Mixcloud</h3>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Posted</dt>
            <dd>{result?.at ? chicagoTimeLabel(result.at) : "[time not recorded]"}</dd>
            <dt className="text-muted">Fingerprint</dt>
            <dd><span className="font-mono text-[13px]" title={record.fingerprint}>{record.fingerprint?.slice(0, 12) ?? "[none]"}</span></dd>
            {result?.url && !isMixcloudUrl(result.url) && (
              <>
                <dt className="text-muted">Address</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]"><span className="font-mono text-[13px]">{result.url}</span></dd>
              </>
            )}
          </dl>
          {isMixcloudUrl(result?.url) && (
            <a href={result.url} className={`mt-4 inline-flex min-h-11 items-center text-sm text-signal ${LINK}`}>Open on Mixcloud</a>
          )}
        </section>
      );
    case "failed":
      return (
        <Banner tone="problem">
          <p className="font-medium">{result?.error || "The upload failed."}</p>
          <p className="mt-1">Approve again after fixing.</p>
        </Banner>
      );
    case "outcome_unknown":
      return (
        <Banner tone="problem">
          <p>We don&apos;t know if it posted. Check Mixcloud before doing anything.</p>
          {mixcloudAccount && (
            <a href={`${MIXCLOUD}${encodeURIComponent(mixcloudAccount)}/`} className={`mt-1 inline-flex min-h-11 items-center ${LINK}`}>
              Your Mixcloud uploads
            </a>
          )}
        </Banner>
      );
    default:
      return null;
  }
}
