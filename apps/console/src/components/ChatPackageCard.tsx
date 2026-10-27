import Link from "next/link";
import type { PackageRecord } from "@aircheck/core";

const STATUS_WORD: Partial<Record<PackageRecord["status"], string>> = {
  preparing_audio: "draft",
  awaiting_review: "draft",
  approved: "approved",
  skipped: "skipped",
};

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-serif text-[26px] leading-none">{n}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

/**
 * Drawn by our code from the package row, never by the model. Counts come from the record.
 * No approve button: approval stays on the package page.
 */
export function ChatPackageCard({ record, packageId }: { record: PackageRecord; packageId: string }) {
  const { title, tags, tracks, flags } = record.draft;
  const closing = tracks.filter((t) => t.closing).length;
  return (
    <article className="flex flex-col gap-4 rounded-card border border-line-strong bg-surface p-4 min-[900px]:p-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="font-mono text-xs tracking-[0.08em] text-signal uppercase">
          Mixcloud package · {STATUS_WORD[record.status] ?? record.status}
        </span>
        <h3 className="font-serif text-2xl leading-tight font-normal [overflow-wrap:anywhere]">{title}</h3>
      </div>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Tags">
          {tags.map((t) => (
            <li key={t} className="rounded-full bg-signal-soft px-3 py-1 text-[13px] font-medium text-signal-deep">{t}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat n={tracks.length} label="tracks" />
        <Stat n={closing} label="closing tracks" />
        <Stat n={tags.length} label="tags" />
      </div>
      {!!flags?.length && (
        <div className="rounded-control bg-surface-quiet p-3.5">
          <p className="mb-1.5 font-mono text-xs tracking-[0.08em] text-muted uppercase">For your review</p>
          <ul className="list-disc pl-5 text-sm leading-relaxed [overflow-wrap:anywhere]">
            {flags.map((f, i) => <li key={`${i}-${f}`}>{f}</li>)}
          </ul>
        </div>
      )}
      <Link
        href={`/packages/${packageId}`}
        className="inline-flex min-h-11 items-center justify-center self-start rounded-control border border-line-strong bg-surface px-4 text-[15px] font-medium"
      >
        Review full package
      </Link>
    </article>
  );
}
