import type { RunState, RunStep } from "@aircheck/core";
import { Pill } from "./Pill";

export interface UpcomingRow { label: string; text: string; status: "next" | "skipped" }
export interface RunTotals { tracks: number; closingSkipped: number }

const COPY = "Stops after this track and opens the draft for you to edit. The agent won't overwrite anything you change.";
const VERIFY = "[verify]";
const chipBase = "rounded-md border px-1.5 py-1 font-mono text-[11px] leading-none";
const neutral = "border-line bg-surface text-ink-soft";
const caution = "border-transparent bg-caution-bg text-caution-text";
// Never combine neutral and caution colour utilities on one element; stylesheet order would decide.
const chipClass = (isVerify: boolean) => `${chipBase} ${isVerify ? caution : neutral}`;

function Chip({ text }: { text: string }) {
  return <span className={chipClass(text.includes(VERIFY))}>{text}</span>;
}

const STATUS_WORD: Record<RunStep["status"], string> = { working: "Working", done: "Done", error: "Error" };
const STATUS_STYLE: Record<RunStep["status"], string> = {
  working: "font-semibold text-ink",
  done: "text-signal-deep",
  error: "text-problem-text",
};

function Row({ label, status, children, current }: { label: string; status: React.ReactNode; children: React.ReactNode; current?: boolean }) {
  return (
    <li className={`grid grid-cols-[44px_1fr_auto] items-start gap-2.5 border-t border-line px-5 py-3 text-sm ${current ? "bg-paper" : ""}`}>
      <span className="font-mono text-xs leading-5 text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
      {status}
    </li>
  );
}

function StepRow({ step, index }: { step: RunStep; index: number }) {
  const verify = step.preview.includes(VERIFY);
  const word = (
    <span className={`whitespace-nowrap text-[12.5px] ${STATUS_STYLE[step.status]}`}>
      {step.status === "working" && <span aria-hidden="true" className="run-pulse mr-1.5 inline-block size-[7px] rounded-full bg-signal align-[1px]" />}
      {STATUS_WORD[step.status]}
    </span>
  );
  return (
    <Row label={step.label ?? String(index + 1)} status={word} current={step.status === "working"}>
      <div className="break-words">
        {step.preview}
        {verify && <> <span className={chipClass(true)}>{VERIFY}</span></>}
      </div>
      {!!step.sources?.length && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {step.sources.map((s, i) => <Chip key={`${i}-${s}`} text={s} />)}
        </div>
      )}
    </Row>
  );
}

export function RunProgressCard({
  title, state, totals, upcoming = [], sample = false, onTakeOver,
}: {
  title: string;
  state: RunState;
  totals: RunTotals;
  upcoming?: UpcomingRow[];
  sample?: boolean;
  onTakeOver: () => void;
}) {
  const done = state.steps.filter((s) => s.status === "done").length;
  const pct = totals.tracks > 0 ? Math.min(100, Math.round((done / totals.tracks) * 100)) : 0;
  const stopping = state.status === "stopping";
  const cancelled = state.status === "cancelled";
  const skipped = totals.closingSkipped;

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <style>{`.run-pulse{animation:run-pulse 1.4s ease-in-out infinite}@keyframes run-pulse{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.run-pulse{animation:none}}`}</style>
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <h2 className="font-serif text-[22px] leading-tight">{title}</h2>
        {sample && <Pill tone="neutral">Sample</Pill>}
      </div>
      <div
        role="progressbar" aria-label="Tracks done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        className="relative mx-5 h-1 rounded-sm bg-surface-quiet"
      >
        <i className="absolute inset-y-0 left-0 rounded-sm bg-signal" style={{ width: `${pct}%` }} />
      </div>
      <p className="px-5 pb-1.5 pt-2.5 text-[13px] text-muted">
        {done} of {totals.tracks} tracks · {skipped} closing {skipped === 1 ? "track" : "tracks"} skipped
      </p>
      <ul>
        {state.steps.map((s, i) => <StepRow key={s.id} step={s} index={i} />)}
        {upcoming.map((u) => (
          <Row key={u.label} label={u.label} status={<span className="whitespace-nowrap text-[12.5px] text-muted">{u.status === "next" ? "Next" : "Skipped"}</span>}>
            <span className="text-muted">{u.text}</span>
          </Row>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5">
        {cancelled ? (
          <p className="text-sm font-semibold">Stopped. Your draft is open.</p>
        ) : (
          <>
            <button
              type="button" onClick={onTakeOver} disabled={stopping}
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold disabled:text-muted"
            >
              {stopping ? "Stopping after this track…" : "Take over"}
            </button>
            <span className="min-w-0 flex-1 basis-56 text-[13px] text-muted">{COPY}</span>
          </>
        )}
      </div>
      <p className="border-t border-line px-5 pb-3.5 pt-2.5 font-mono text-[11px] leading-snug text-muted">
        Live from the agent&apos;s run · steps stream in as they happen
      </p>
    </section>
  );
}
