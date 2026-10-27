"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface PlayerTrack {
  src: string;
  title: string;
  durationSec: number;
  hour2AtSec?: number;
}

export interface PlayerState {
  track: PlayerTrack | null;
  playing: boolean;
  positionSec: number;
  load(t: PlayerTrack): void;
  toggle(): void;
  seek(sec: number): void;
  jumpToHour2(): void;
  /** A PlayerBar calls this while mounted; Space only works while at least one is. Returns the unregister fn. */
  register(): () => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

// Space must not hijack typing, and a focused button already toggles itself on Space.
const IGNORED = "input, textarea, select, button, a, [contenteditable]";

/** Owns the single <audio> element so playback survives client-side navigation. */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const bars = useRef(0);

  const load = useCallback((t: PlayerTrack) => {
    setTrack((cur) => {
      if (cur?.src === t.src) return cur.title === t.title ? cur : { ...cur, title: t.title }; // same audio: keep position
      setPositionSec(0);
      setPlaying(false);
      return t;
    });
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.getAttribute("src")) return;
    if (a.paused) void a.play()?.catch(() => setPlaying(false));
    else a.pause();
  }, []);

  const seek = useCallback((sec: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = sec;
    setPositionSec(sec);
  }, []);

  const jumpToHour2 = useCallback(() => {
    if (track?.hour2AtSec !== undefined) seek(track.hour2AtSec);
  }, [track, seek]);

  const register = useCallback(() => {
    bars.current += 1;
    return () => {
      bars.current -= 1;
    };
  }, []);

  // One listener here (not per PlayerBar) so several bars can never double-toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.defaultPrevented || bars.current === 0) return;
      if ((e.target as Element | null)?.closest?.(IGNORED)) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo(
    () => ({ track, playing, positionSec, load, toggle, seek, jumpToHour2, register }),
    [track, playing, positionSec, load, toggle, seek, jumpToHour2, register],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        src={track?.src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPositionSec(e.currentTarget.currentTime)}
      />
    </PlayerContext.Provider>
  );
}
