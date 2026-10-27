import { Pill, type PillTone } from "./Pill";

export type TrustFilter = "all" | "waiting" | "action" | "network" | "blocked";

export type ActivityRow = {
  at: number;
  kind: "waiting" | "action" | "network";
  title: string;
  destination?: string;
  result: "needs_you" | "done" | "allowed" | "blocked";
  reason?: string;
};

export const FILTERS: readonly TrustFilter[] = ["all", "waiting", "action", "network", "blocked"];

export const parseFilter = (v: string | null | undefined): TrustFilter =>
  FILTERS.find((f) => f === v) ?? "all";

const CHIPS: Record<TrustFilter, { label: string; test: (r: ActivityRow) => boolean; empty: string }> = {
  all: { label: "All", test: () => true, empty: "Nothing has happened yet." },
  waiting: { label: "Waiting for you", test: (r) => r.kind === "waiting", empty: "Nothing is waiting for you." },
  action: { label: "Agent actions", test: (r) => r.kind === "action", empty: "The agent has not taken any actions yet." },
  network: { label: "Network", test: (r) => r.kind === "network", empty: "No network calls yet." },
  blocked: { label: "Blocked", test: (r) => r.result === "blocked", empty: "Nothing has been blocked." },
};

const RESULT: Record<ActivityRow["result"], { tone: PillTone; word: string }> = {
  needs_you: { tone: "caution", word: "Needs you" },
  done: { tone: "ready", word: "Done" },
  allowed: { tone: "neutral", word: "Allowed" },
  blocked: { tone: "problem", word: "Blocked" },
};

const KIND = { waiting: "Waiting", action: "Action", network: "Network" } as const;

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
/** HH:mm:ss in Chicago time. */
export const chicagoTime = (ms: number) => clock.format(ms);

const th = "px-3 py-2.5 text-left font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted";
const td = "border-t border-line px-3 py-3 align-top";

export function Timeline({
  rows,
  filter,
  onFilterChange,
}: {
  rows: readonly ActivityRow[];
  filter: TrustFilter;
  onFilterChange: (f: TrustFilter) => void;
}) {
  const shown = rows.filter(CHIPS[filter].test);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f === filter;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => onFilterChange(f)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm ${
                on ? "border-ink bg-ink text-paper" : "border-line bg-surface"
              } ${f === "blocked" && !on ? "text-problem-text" : ""}`}
            >
              {CHIPS[f].label} <b className="font-semibold">{rows.filter(CHIPS[f].test).length}</b>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{CHIPS[filter].empty}</p>
      ) : (
        <section className="overflow-x-auto rounded-card border border-line bg-surface p-2">
          <table className="w-full min-w-[720px] border-collapse text-sm tabular-nums">
            <thead>
              <tr>
                {["Time", "Kind", "What happened", "Where", "Result"].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const res = RESULT[r.result];
                return (
                  <tr key={`${r.at}-${i}`} className={r.result === "blocked" ? "bg-problem-row" : ""}>
                    <td className={`${td} font-mono text-[12.5px]`}>{chicagoTime(r.at)}</td>
                    <td className={`${td} font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted`}>{KIND[r.kind]}</td>
                    <td className={td}>{r.title}</td>
                    <td className={`${td} font-mono text-[12.5px]`}>{r.destination ?? "—"}</td>
                    <td className={td}>
                      <Pill tone={res.tone}>{res.word}</Pill>
                      {r.result === "blocked" && r.reason ? <div className="mt-1 text-xs text-muted">{r.reason}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
