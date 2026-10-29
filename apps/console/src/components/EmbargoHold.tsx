"use client";

import { useState } from "react";

/** packages.get's `embargo`: what holds this package, with the release each blocking line comes from (a private view). */
export type EmbargoView = { blocking: { releaseId: string; text: string }[]; sameArtist: string[] };
/** radar.setEmbargo({ releaseId, embargo: null }). Convex lets only a signed-in human clear a release in their workspace. */
export type ClearEmbargoFn = (releaseId: string) => Promise<unknown>;

/**
 * Plan 8: an embargoed release in this package holds Approve until its date. Each line shows in the problem colour with
 * "Clear embargo", which asks once before it lets the release reach Mixcloud. Same-artist matches are review notes.
 */
export function EmbargoHold({ embargo, clear }: { embargo: EmbargoView; clear?: ClearEmbargoFn }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const BTN = "min-h-11 rounded-control border border-problem-text px-4 font-medium";

  async function confirm(releaseId: string) {
    setFailed(false);
    try {
      await clear!(releaseId);
      setAsking(null);
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      {embargo.blocking.length > 0 && (
        <ul aria-label="Embargoes" className="flex flex-col gap-2">
          {embargo.blocking.map((b) => (
            <li key={b.releaseId} className="flex flex-col gap-2 rounded-control bg-problem-bg px-4 py-3 text-sm text-problem-text">
              <span className="[overflow-wrap:anywhere]">{b.text}. Approve after that date, or clear the embargo.</span>
              {clear &&
                (asking === b.releaseId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">Clearing it lets this release reach Mixcloud.</span>
                    <button type="button" onClick={() => confirm(b.releaseId)} className={BTN}>Clear it</button>
                    <button type="button" onClick={() => setAsking(null)} className={BTN}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAsking(b.releaseId)} className={`${BTN} self-start`}>Clear embargo</button>
                ))}
              {failed && asking === b.releaseId && <span role="alert">The embargo could not be cleared. Try again.</span>}
            </li>
          ))}
        </ul>
      )}
      {embargo.sameArtist.length > 0 && (
        <ul aria-label="Review notes" className="flex flex-col gap-1 text-[12.5px] text-ink-soft">
          {embargo.sameArtist.map((s) => (
            <li key={s} className="[overflow-wrap:anywhere]">Same artist as an embargoed release: {s}.</li>
          ))}
        </ul>
      )}
    </>
  );
}
