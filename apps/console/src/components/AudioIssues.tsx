import { Pill } from "./Pill";

export type AudioIssue = { showDate: string; reason: string };

/** Today: shows whose hour WAVs the media service couldn't turn into an MP3, and why. Hidden when there are none. */
export function AudioIssues({ issues }: { issues: AudioIssue[] | undefined }) {
  if (!issues?.length) return null;
  return (
    <section aria-labelledby="audio-issues" className="rounded-card border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="audio-issues" className="text-base font-semibold">Audio not ready</h2>
        <Pill tone="caution">{issues.length === 1 ? "1 show" : `${issues.length} shows`}</Pill>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {issues.map((i) => (
          <li key={`${i.showDate}:${i.reason}`} className="py-2.5 text-sm text-ink-soft [overflow-wrap:anywhere] first:pt-0">{i.reason}</li>
        ))}
      </ul>
    </section>
  );
}
