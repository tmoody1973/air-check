"use client";

import { useEffect } from "react";
import { usePlayer, type PlayerTrack } from "./PlayerProvider";

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${h}:${m}:${String(s % 60).padStart(2, "0")}`;
}

export function PlayerBar({ track }: { track: PlayerTrack | null }) {
  const p = usePlayer();
  const src = track?.src;
  const { register } = p;
  const hasTrack = !!track;
  useEffect(() => (hasTrack ? register() : undefined), [register, hasTrack]);
  const title = track?.title;
  useEffect(() => {
    if (track) p.load(track);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load only when the source or title changes
  }, [src, title]);

  if (!track) {
    return (
      <div className="flex h-14 items-center rounded-card bg-ink px-4 text-[13px] text-chip">
        Audio preview arrives with the media job
      </div>
    );
  }

  const active = p.track ?? track;
  const dur = p.mediaDurationSec ?? active.durationSec ?? null;
  const pct = dur ? Math.min(100, (p.positionSec / dur) * 100) : 0;
  const tick = dur && active.hour2AtSec !== undefined ? Math.min(100, (active.hour2AtSec / dur) * 100) : null;

  return (
    <div className="flex min-h-14 items-center gap-3 rounded-card bg-ink py-1 pr-3 pl-2 text-paper">
      <button
        type="button"
        onClick={p.toggle}
        aria-label={p.playing ? "Pause" : "Play"}
        className="grid size-11 flex-none place-items-center rounded-full bg-surface text-ink"
      >
        {p.playing ? (
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M2 1h3.5v14H2zM8.5 1H12v14H8.5z" fill="currentColor" /></svg>
        ) : (
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1.5v13L13 8z" fill="currentColor" /></svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{active.title}</div>
        <div className="mt-0.5 whitespace-nowrap font-mono text-[11.5px] leading-tight text-chip">
          {formatClock(p.positionSec)} / {dur ? formatClock(dur) : "–:––:––"}
        </div>
        <div className="relative mt-1.5 h-[3px] rounded-[2px] bg-ink-soft" aria-hidden="true">
          <i className="absolute inset-y-0 left-0 rounded-[2px] bg-signal-on-dark" style={{ width: `${pct}%` }} />
          {tick !== null && <span className="absolute -top-[3px] h-[9px] w-px bg-muted" style={{ left: `${tick}%` }} />}
        </div>
      </div>
      <button
        type="button"
        onClick={p.jumpToHour2}
        disabled={active.hour2AtSec === undefined}
        className="min-h-11 whitespace-nowrap rounded-control border border-ink-soft px-2.5 text-[12.5px] font-medium text-paper disabled:opacity-50"
      >
        Jump to hour 2
      </button>
    </div>
  );
}
