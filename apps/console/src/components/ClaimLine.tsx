import type { JudgedClaim } from "@aircheck/core";
import { isOpenClaim, safeHref } from "@/lib/research";

// One claim: the agent's sentence as plain text (React escapes it; no HTML, no auto-linking), then code's own words:
// the [verify] chip and its check, and each source as a host chip that links out. Only Tarik's click opens a source.

export const CHIP = "inline-flex min-h-6 items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-none";
export const NEUTRAL_CHIP = `${CHIP} border-line bg-surface text-ink-soft`;
// Never combine neutral and caution colour utilities on one element; stylesheet order would decide.
export const VERIFY_CHIP = `${CHIP} border-transparent bg-caution-bg text-caution-text`;

export function SourceChips({ sources }: { sources: JudgedClaim["sources"] }) {
  const seen = new Set<string>();
  const unique = sources.filter((s) => !seen.has(s.url) && seen.add(s.url));
  if (!unique.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {unique.map((s) => {
        const href = safeHref(s.url);
        return href ? (
          <a
            key={s.url} href={href} target="_blank" rel="noopener noreferrer nofollow" title={s.title}
            className={`${NEUTRAL_CHIP} hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal`}
          >
            {s.host}
          </a>
        ) : (
          <span key={s.url} className={NEUTRAL_CHIP}>{s.host}</span>
        );
      })}
    </span>
  );
}

export function ClaimLine({ claim }: { claim: JudgedClaim }) {
  const open = isOpenClaim(claim);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="[overflow-wrap:anywhere]">
        {open && <><span className={VERIFY_CHIP}>[verify]</span>{" "}</>}
        <span>{claim.text}</span>
        {open && claim.check && <span className="text-caution-text"> — {claim.check}</span>}
      </p>
      <SourceChips sources={claim.sources} />
    </div>
  );
}
