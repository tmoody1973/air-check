"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PackageRecord } from "@aircheck/core";
import { chatErrorText, MAX_MESSAGE_CHARS, progressLine } from "../lib/chat";
import { ChatPackageCard } from "./ChatPackageCard";
import { LiveTag } from "./RunProgressCard";
import { SampleTag } from "./SampleTag";

export type ChatMessage = { _id: string; role: "user" | "assistant"; text: string; runId?: string; at: number };
/** The slice of `api.runs.get` the thread reads. */
export type RunView = {
  status: "queued" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  source: "live" | "scripted";
  state: { steps: readonly { tool: string }[] };
  packageId?: string;
};

type Props = {
  /** undefined while loading. */
  messages: ChatMessage[] | undefined;
  send: (text: string) => Promise<unknown>;
  /** Reactive lookups injected by the page (Convex hooks); called once per assistant message. */
  useRun: (runId: string) => RunView | null | undefined;
  usePackage: (packageId: string | undefined) => PackageRecord | null | undefined;
  headerSlot?: ReactNode;
  /** The conversation id in the URL is not one of ours: show a plain note instead of a fresh chat. */
  missing?: boolean;
  /** False until Convex has the Clerk token; sending before then fails with UNAUTHENTICATED. */
  authReady?: boolean;
};

const NEAR_BOTTOM_PX = 120;
const atBottom = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight < NEAR_BOTTOM_PX;

const GOING = new Set(["queued", "running", "stopping"]);

function EmptyReply({ run }: { run: RunView | null | undefined }) {
  if (run === null) return <span className="text-muted">Run unavailable.</span>;
  const status = run?.status;
  if (status === undefined || GOING.has(status)) {
    return <span role="status" aria-label="The agent is writing" className="text-muted">…</span>;
  }
  if (status === "failed") return <span className="text-problem-text">The agent stopped with an error.</span>;
  if (status === "cancelled") return <span className="text-muted">Stopped.</span>;
  return <span className="text-muted">The agent finished without a reply.</span>;
}

function AssistantMessage({ m, useRun, usePackage, onGrow }: { m: ChatMessage; onGrow: () => void } & Pick<Props, "useRun" | "usePackage">) {
  const run = useRun(m.runId ?? "");
  const pkg = usePackage(run?.packageId);
  const line = run ? progressLine(run.status, run.state.steps) : null;
  // A streamed reply, a new step or the card arriving makes the thread taller without adding a message.
  useEffect(() => { onGrow(); }, [onGrow, m.text.length, run?.status, run?.state.steps.length, !!pkg]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Agent text is untrusted: plain text only, line breaks kept, never parsed as HTML. */}
      <p className="text-[15px] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {m.text === "" ? <EmptyReply run={run} /> : m.text}
      </p>
      {run?.packageId && pkg && <ChatPackageCard record={pkg} packageId={run.packageId} />}
      <div className="flex flex-wrap items-center gap-x-3">
        {run && (run.source === "live" ? <LiveTag /> : <SampleTag>Sample · scripted</SampleTag>)}
        {line && m.runId && (
          <Link href={`/runs/${m.runId}`} className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-2">
            {line}
          </Link>
        )}
      </div>
    </div>
  );
}

export function ChatThread({ messages, send, useRun, usePackage, headerSlot, missing = false, authReady = true }: Props) {
  // One Hermes run per session at a time: while the latest run is going, the next message waits.
  const latestRunId = messages?.findLast((m) => m.role === "assistant" && m.runId)?.runId ?? "";
  const latestRun = useRun(latestRunId);
  const agentBusy = !!latestRun && GOING.has(latestRun.status);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ text: string; sent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false); // state lags a fast second Enter; a ref does not
  const end = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => { nearBottom.current = atBottom(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Follow new content only while the reader is already at the bottom.
  const follow = useCallback(() => { if (nearBottom.current) end.current?.scrollIntoView?.({ block: "end" }); }, []);

  // The sent message stays on screen until the server's copy is in `messages` (also across the first-message navigation).
  const saved = pending?.sent && messages?.some((m) => m.role === "user" && m.text === pending.text);
  const shownPending = pending && !saved ? pending.text : null;
  useEffect(() => { if (saved) setPending(null); }, [saved]);
  const count = (messages?.length ?? 0) + (shownPending ? 1 : 0);
  useEffect(() => { if (count > 0) follow(); }, [count, follow]);

  async function submit() {
    const body = text.trim();
    if (!body || sending.current || agentBusy || !authReady) return;
    if (body.length > MAX_MESSAGE_CHARS) { setError(chatErrorText({ data: { code: "INVALID_INPUT" } })); return; }
    sending.current = true;
    setError(null);
    nearBottom.current = true; // sending always follows
    setPending({ text: body, sent: false });
    setText("");
    try {
      await send(body);
      setPending((p) => (p ? { ...p, sent: true } : p));
    } catch (e) {
      setError(chatErrorText(e));
      setPending(null);
      setText((cur) => (cur === "" ? body : cur)); // never overwrite what was typed meanwhile
    } finally {
      sending.current = false;
    }
  }

  const busy = (pending !== null && !pending.sent) || agentBusy || !authReady;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {headerSlot}
      <div role="log" aria-label="Conversation" className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-6">
        {messages === undefined && !shownPending && <p className="text-ink-soft">Loading…</p>}
        {!missing && messages?.length === 0 && !shownPending && (
          <p className="text-[15px] leading-relaxed text-ink-soft">Ask Air Check to draft a package, check a tracklist or plan a show.</p>
        )}
        {messages?.map((m) =>
          m.role === "user" ? (
            <p key={m._id} className="max-w-[80%] self-end rounded-[16px_16px_4px_16px] bg-ink px-4 py-3 text-[15px] leading-normal whitespace-pre-wrap text-paper [overflow-wrap:anywhere]">{m.text}</p>
          ) : (
            <AssistantMessage key={m._id} m={m} useRun={useRun} usePackage={usePackage} onGrow={follow} />
          ),
        )}
        {shownPending && (
          <p className="max-w-[80%] self-end rounded-[16px_16px_4px_16px] bg-ink px-4 py-3 text-[15px] leading-normal whitespace-pre-wrap text-paper [overflow-wrap:anywhere]">{shownPending}</p>
        )}
      </div>

      {missing ? (
        <div className="mx-auto flex w-full max-w-[760px] flex-col items-start gap-2">
          <p className="text-[15px] text-ink-soft">That conversation isn&apos;t here.</p>
          <Link href="/chat" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">Start a new conversation</Link>
        </div>
      ) : (

      <form
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        className="sticky bottom-0 mx-auto flex w-full max-w-[760px] flex-col gap-2 bg-paper pt-2 pb-4"
      >
        {error && <p role="alert" className="text-sm text-problem-text">{error}</p>}
        {!authReady && <p role="status" className="text-sm text-muted">Signing you in…</p>}
        {agentBusy && <p role="status" className="text-sm text-muted">The agent is still working…</p>}
        <div className="flex items-end gap-2.5 rounded-[14px] border border-line-strong bg-surface py-2 pr-2 pl-4">
          <label htmlFor="ask" className="sr-only">Message Air Check</label>
          <textarea
            id="ask"
            rows={1}
            value={text}
            disabled={!authReady}
            placeholder="Ask Air Check to draft, check or plan a show"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void submit(); }
            }}
            className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy}
            className="flex size-11 flex-none items-center justify-center rounded-control bg-ink text-paper disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </form>
      )}
      <div ref={end} />
    </div>
  );
}
