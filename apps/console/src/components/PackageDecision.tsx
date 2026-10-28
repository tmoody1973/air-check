"use client";

import type { GateErrorCode, PackageRecord } from "@aircheck/core";
import Link from "next/link";
import { useState } from "react";
import { showDateLabel } from "../lib/date";
import { trackFor } from "../lib/track";
import { CoverPicker, type CoverChangeFn } from "./CoverPicker";
import { PlayerBar } from "./PlayerBar";
import { Pill, type PillTone } from "./Pill";
import { isMixcloudUrl, PublishStatus, type PublishState, type SettleFns, type SettleResult } from "./PublishStatus";
import { SampleTag } from "./SampleTag";
import type { Workspace } from "./Shell";

export type DecideResult = { ok: true } | { ok: false; code: GateErrorCode; message: string };
export type DecideFn = (decision: "approve" | "skip", fingerprint: string) => Promise<DecideResult>;
export type { CoverChangeFn, PublishState, SettleFns };

const BTN = "grid min-h-12 w-full place-items-center rounded-control border px-4 text-[15px] font-semibold whitespace-nowrap disabled:opacity-60";

function statusPill(rec: PackageRecord, workspace: Workspace): { tone: PillTone; label: string } {
  const n = rec.draft.flags?.length ?? 0;
  switch (rec.status) {
    case "awaiting_review":
    case "preparing_audio":
      return { tone: "caution", label: n === 0 ? "Draft" : `Draft · ${n} ${n === 1 ? "flag" : "flags"}` };
    case "approved":
    case "publishing":
      return { tone: "ready", label: workspace === "demo" ? "Approved · sample, not published" : "Approved · queued" };
    case "skipped":
      return { tone: "neutral", label: "Skipped" };
    case "succeeded":
      return { tone: "ready", label: "Published" };
    case "outcome_unknown":
      return { tone: "problem", label: "Upload uncertain" };
    default:
      return { tone: "problem", label: "Upload failed" };
  }
}

const isDeciding = (rec: PackageRecord) => rec.status === "awaiting_review" || rec.status === "preparing_audio";
const codePoints = (s: string) => [...s].length;

export function PackageDecision({
  record: live,
  workspace,
  decide,
  needsMixcloud = false,
  cover,
  publish,
  mixcloudAccount,
  settle,
}: {
  record: PackageRecord | null;
  workspace: Workspace;
  decide: DecideFn;
  /** Real workspace with no working Mixcloud connection: Approve still works, the package waits in the queue. */
  needsMixcloud?: boolean;
  /** Real workspace: the cover's URL (own or standard) and how to replace it. */
  cover?: { url: string | null; change: CoverChangeFn };
  /** Real workspace: where an approved package stands in the publisher's queue (packages.publishState). */
  publish?: PublishState | null;
  /** The connected Mixcloud account, for the "check your uploads" link. */
  mixcloudAccount?: string;
  /** Real workspace: reopen or confirm a failed or uncertain upload (I2). */
  settle?: SettleFns;
}) {
  const [pending, setPending] = useState<"approve" | "skip" | null>(null);
  const [notice, setNotice] = useState<{ code: GateErrorCode | null; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  // While deciding, pin what the host reviews: the first record seen stays on screen until they
  // choose to reload. A package that is already decided shows the live record, so it never freezes.
  const [snap, setSnap] = useState<PackageRecord | null>(live);
  const [decided, setDecided] = useState(false);
  if (!snap && live) setSnap(live);
  const pinned = !decided && !!snap && isDeciding(snap);
  const record = (pinned ? snap : live) ?? snap ?? live;
  const changed = pinned && !!live && (live.fingerprint !== snap.fingerprint || live.status !== snap.status);

  if (!record)
    return <p className="rounded-card border border-line bg-surface p-5 text-ink-soft">Package not found</p>;

  const { draft } = record;
  const pill = statusPill(record, workspace);
  const flags = draft.flags ?? [];
  const closing = draft.tracks.filter((t) => t.closing).length;
  const deciding = isDeciding(record);
  const ready = record.status === "awaiting_review" && !!record.fingerprint;
  const canApprove = ready && !changed;
  const busy = pending !== null || decided;
  const track = trackFor(workspace, record);
  // The cover can change only on the version the host is looking at; a stale page reloads first.
  const changeCover: CoverChangeFn | undefined =
    record.status === "awaiting_review" && !changed && !busy && cover
      ? async (file) => {
          const res = await cover.change(file);
          // The host picked this cover, so the re-fingerprinted record becomes what they review and approve.
          if (res.ok) setSnap(res.record);
          return res;
        }
      : undefined;
  // A reopened package is reviewed afresh: this session's earlier Approve no longer locks the buttons.
  const settleHere: SettleFns | undefined = settle && {
    confirmPosted: settle.confirmPosted,
    reopen: async (): Promise<SettleResult> => {
      const res = await settle.reopen();
      if (res.ok) {
        setDecided(false);
        setSnap(res.record);
        setNotice(null);
      }
      return res;
    },
  };
  const reload = () => {
    setSnap(live);
    setNotice(null);
  };

  async function run(decision: "approve" | "skip") {
    if (!record?.fingerprint || changed) return;
    setPending(decision);
    setNotice(null);
    try {
      const res = await decide(decision, record.fingerprint);
      if (res.ok) setDecided(true);
      else
        setNotice({
          code: res.code,
          text: res.code === "NOT_READY" ? "The audio is still being prepared." : res.message,
        });
    } catch {
      setNotice({ code: null, text: "Something went wrong. Try again." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[13px] tracking-wide text-muted uppercase">Show of {showDateLabel(draft.showDate)}</span>
        {record.status === "succeeded" && isMixcloudUrl(record.result?.url) ? (
          <Link href={record.result.url} className="rounded-full">
            <Pill tone={pill.tone}>{pill.label}</Pill>
          </Link>
        ) : (
          <Pill tone={pill.tone}>{pill.label}</Pill>
        )}
        {workspace === "demo" && <SampleTag />}
      </div>

      <section className="min-w-0 rounded-card border border-line bg-surface p-5">
        <h2 className="font-serif text-[28px] leading-[1.15] font-normal [overflow-wrap:anywhere]">{draft.title}</h2>
        <ul className="mt-3.5 flex flex-wrap gap-2" aria-label="Tags">
          {draft.tags.map((t) => (
            <li key={t} className="rounded-full bg-chip px-2.5 py-0.5 text-[12.5px] text-ink-soft [overflow-wrap:anywhere]">{t}</li>
          ))}
        </ul>
        <dl className="my-4 grid grid-cols-3 gap-2 border-y border-line py-3.5">
          {[
            [draft.tracks.length, "tracks"],
            [closing, "closing tracks"],
            [codePoints(draft.description), "description chars"],
          ].map(([n, label]) => (
            <div key={label}>
              <dd className="font-serif text-[26px] leading-none">{n}</dd>
              <dt className="mt-1 text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>
        {flags.length > 0 && (
          <ol className="flex flex-col gap-1.5">
            {flags.map((f, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-ink-soft">
                <span className="mt-px size-5 flex-none rounded-full bg-caution-bg text-center text-[11px] leading-5 font-semibold text-caution-text">{i + 1}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{f}</span>
              </li>
            ))}
          </ol>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="mt-3 flex min-h-11 items-center gap-1 text-sm font-medium text-signal"
        >
          See description and tracklist <span aria-hidden="true">{open ? "⌄" : "›"}</span>
        </button>
        {open && (
          <div className="mt-2 flex flex-col gap-4 border-t border-line pt-4 text-sm">
            <div>
              <p className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{draft.description}</p>
              <p className="mt-1 font-mono text-xs text-muted">{codePoints(draft.description)} characters</p>
            </div>
            <ol className="flex flex-col gap-1">
              {draft.tracks.map((t) => (
                <li key={`${t.hour}-${t.position}`} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono text-xs text-muted">{t.hour}.{t.position}</span>
                  <span className="[overflow-wrap:anywhere]">{t.artist} – {t.title}{t.feat ? ` feat. ${t.feat}` : ""}</span>
                  {t.closing && <span className="rounded-full bg-chip px-2 py-0.5 text-xs text-ink-soft">closing track</span>}
                </li>
              ))}
            </ol>
            {(draft.alternates?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs text-muted">Other title options</p>
                <ul className="mt-1">{draft.alternates!.map((a) => <li key={a} className="[overflow-wrap:anywhere]">{a}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </section>

      {(track || record.status === "preparing_audio") && <PlayerBar track={track} />}

      {workspace === "real" && cover && <CoverPicker url={cover.url} custom={!!draft.coverStorageId} onChange={changeCover} />}

      {workspace === "real" && !deciding && <PublishStatus record={record} publish={publish} mixcloudAccount={mixcloudAccount} settle={settleHere} />}

      {workspace === "demo" ? (
        <p className="text-[12.5px] text-ink-soft">Demo workspace · Sample data. Publishing to Mixcloud is switched off.</p>
      ) : (
        deciding && <p className="text-[12.5px] text-ink-soft">This will be public on Mixcloud</p>
      )}

      {deciding && (
        <>
          {needsMixcloud && workspace === "real" && (
            <p className="text-[12.5px] text-ink-soft">
              <Link href="/settings" className="font-medium text-signal underline underline-offset-2">Connect Mixcloud to publish</Link>
              . Approving still works: the show waits in the queue until Mixcloud is connected.
            </p>
          )}
          {!ready && record.status === "preparing_audio" && (
            <p className="text-[12.5px] text-muted">The audio is still being prepared.</p>
          )}
          {(changed || notice) && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-control bg-problem-bg px-4 py-3 text-sm text-problem-text">
              <span className="min-w-0 flex-1">{changed ? "This package changed. Open the latest version." : notice?.text}</span>
              {(changed || notice?.code === "PACKAGE_CHANGED") && (
                <button type="button" onClick={reload} className="min-h-11 rounded-control border border-problem-text px-4 font-medium">Reload</button>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <button type="button" disabled={!canApprove || busy} onClick={() => run("approve")} className={`${BTN} border-signal bg-signal text-white`}>
              {pending === "approve" ? "Approving…" : "Approve"}
            </button>
            <Link
              href="/chat"
              aria-disabled={busy}
              className={`${BTN} border-line-strong bg-surface text-ink ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              Edit
            </Link>
            <button type="button" disabled={busy || changed || !record.fingerprint} onClick={() => run("skip")} className={`${BTN} border-line-strong bg-surface text-ink`}>
              {pending === "skip" ? "Skipping…" : "Skip"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
