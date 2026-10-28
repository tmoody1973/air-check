import type { GateErrorCode, PackageRecord } from "@aircheck/core";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { chicagoTimeLabel, dayKeyLabel } from "../lib/date";

/** packages.publishState's answer, plus the Chicago day key (`today`) it was asked for, so count and label agree. */
export type PublishState = {
  dayOffset: number | null; mixcloudState: "connected" | "needs_reconnect" | "not_connected"; today: string;
  /** The publisher's last short error code (Mixcloud status row), e.g. a cover it could not use. */
  lastError?: string;
};

export type SettleResult = { ok: true; record: PackageRecord } | { ok: false; code: GateErrorCode; message: string };
/** I2: how a signed-in human settles a failed or uncertain upload (packages.reopen / packages.confirmPosted). */
export type SettleFns = { reopen: () => Promise<SettleResult>; confirmPosted: (url: string) => Promise<SettleResult> };

const MIXCLOUD = "https://www.mixcloud.com/";
/** A receipt URL becomes a link only on Mixcloud's own site; anything else is shown as text. */
export const isMixcloudUrl = (url: string | undefined): url is string => !!url?.startsWith(MIXCLOUD);

/** Why an approved show is not going up yet, when the publisher said (I3). */
const PAUSED: Record<string, string> = {
  cover_unavailable: "Publishing is paused: the cover image couldn't be downloaded. It tries again on its own.",
  bad_cover: "Publishing is paused: the standard cover isn't an image Mixcloud takes. Replace it to continue.",
};

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

// The recovery buttons sit on the problem banner, so they take its ink, like PackageDecision's Reload.
const ACTION = "min-h-11 rounded-control border border-problem-text px-4 font-medium whitespace-nowrap disabled:opacity-60";

/** True for a show's own address on Mixcloud: the prefix and something after it. */
const isShowUrl = (url: string) => isMixcloudUrl(url) && url.length > MIXCLOUD.length;

function SettleActions({ settle, uncertain }: { settle: SettleFns; uncertain: boolean }) {
  const [pending, setPending] = useState<"reopen" | "confirm" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  async function run(kind: "reopen" | "confirm", call: () => Promise<SettleResult>) {
    setPending(kind);
    setProblem(null);
    try {
      const res = await call();
      if (!res.ok) setProblem(res.message);
    } catch {
      setProblem("Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  }
  function confirm(e: FormEvent) {
    e.preventDefault();
    const address = url.trim();
    if (!isShowUrl(address)) return setProblem(`Paste the show's address from Mixcloud. It starts with ${MIXCLOUD}`);
    void run("confirm", () => settle.confirmPosted(address));
  }
  const busy = pending !== null;
  const reopen = (
    <button type="button" disabled={busy} onClick={() => run("reopen", settle.reopen)} className={ACTION}>
      {pending === "reopen" ? "Reopening…" : uncertain ? "It isn't — reopen" : "Reopen for review"}
    </button>
  );

  return (
    <div className="mt-3 flex flex-col gap-3">
      {uncertain ? (
        <>
          <form onSubmit={confirm} noValidate className="flex flex-col gap-1.5">
            <label htmlFor="show-url" className="font-medium">Show address on Mixcloud</label>
            <div className="flex flex-wrap gap-2">
              <input
                id="show-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={url}
                onChange={(e) => setUrl(e.target.value)} placeholder={`${MIXCLOUD}…`}
                className="min-h-11 min-w-0 flex-1 basis-56 rounded-control border border-line-strong bg-surface px-3 font-mono text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              />
              <button type="submit" disabled={busy} className={ACTION}>{pending === "confirm" ? "Saving…" : "It's on Mixcloud"}</button>
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {reopen}
            <span>Not there? Reopen it to review and approve again.</span>
          </div>
        </>
      ) : (
        <div>{reopen}</div>
      )}
      {problem && <p role="alert" className="font-medium">{problem}</p>}
    </div>
  );
}

/** Where a decided real package stands with Mixcloud: queued, uploading, the receipt, or what went wrong. */
export function PublishStatus({ record, publish, mixcloudAccount, settle }: {
  record: PackageRecord;
  publish?: PublishState | null;
  mixcloudAccount?: string;
  /** Real workspace, signed-in staff: reopen or confirm a failed or uncertain upload. */
  settle?: SettleFns;
}) {
  const { result } = record;
  switch (record.status) {
    case "approved":
      if (!publish) return null;
      return publish.mixcloudState === "connected" ? (
        <Banner tone="ready">
          <p>{queuedText(publish)}</p>
          {publish.lastError && PAUSED[publish.lastError] && <p className="mt-1">{PAUSED[publish.lastError]}</p>}
        </Banner>
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
          <p className="mt-1">Reopen to review again. You&apos;ll need to approve it again.</p>
          {settle && <SettleActions settle={settle} uncertain={false} />}
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
          {settle && <SettleActions settle={settle} uncertain />}
        </Banner>
      );
    default:
      return null;
  }
}
