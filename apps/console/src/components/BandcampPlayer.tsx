"use client";

import { bandcampEmbedSrc, type BandcampEmbed } from "@aircheck/core";
import { useState } from "react";
import { SECONDARY, errorText } from "./EpisodeControls";
import { SampleTag } from "./SampleTag";

// Plan 8: Bandcamp's own player on a release. The iframe src is built in code from the stored {kind, id} only (core's
// bandcampEmbedSrc), never from fetched text, and loads only when Tarik taps Play: nothing reaches Bandcamp before then.
// Audio streams from Bandcamp to his browser; Air Check stores none. The demo has no players (no real music, Hard Rule 9).

const STALE_MS = 10 * 60_000; // the ingest worker reads queued pages every minute; radar.notAdded uses the same 10

const FAILED: Record<string, string> = {
  not_allowed: "the link isn't a public Bandcamp album or track page",
  redirect_off_host: "the page pointed to another site, so Air Check stopped there",
  too_many_redirects: "the page redirected too many times",
  not_html: "the link wasn't a web page",
  too_large: "the page was over 2 MB",
  no_player: "the page has no player",
  timeout: "Bandcamp took longer than 15 seconds",
  network: "Bandcamp couldn't be reached",
  bad_id: "the stored player id isn't valid",
};

/** The iframe src, or null when the stored id is malformed (core throws): the page shows "No player" instead of crashing. */
function playerSrc(embed: BandcampEmbed | undefined): string | null {
  if (!embed) return null;
  try {
    return bandcampEmbedSrc(embed);
  } catch {
    return null;
  }
}

/** The ingest worker's failure code as plain words. Unknown codes never show raw. */
export function embedErrorText(code: string | undefined): string {
  const http = /^http_(\d{3})$/.exec(code ?? "");
  if (http) return `Bandcamp answered with error ${http[1]}`;
  return (code && FAILED[code]) || "the Bandcamp page couldn't be read";
}

export type PlayerProps = {
  artist: string;
  title: string;
  embed?: BandcampEmbed;
  embedState?: "queued" | "ready" | "failed";
  embedError?: string;
  embedQueuedAt?: number;
  demo: boolean;
  onRetry: () => Promise<unknown>;
  /** The listening queue's Play button already asked: show the player straight away, no second tap. */
  autoPlay?: boolean;
};

export function BandcampPlayer({ artist, title, embed, embedState, embedError, embedQueuedAt, demo, onRetry, autoPlay = false }: PlayerProps) {
  const [playing, setPlaying] = useState(autoPlay);
  const [retry, setRetry] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  if (demo)
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-dashed border-line-strong bg-surface-quiet px-4 text-sm text-muted">
        <span>[Bandcamp player]</span>
        <SampleTag />
      </div>
    );
  // Queued with a stored id is a page re-read for its date: the player that already worked stays usable meanwhile.
  if (embedState === "queued" && !embed) {
    // ponytail: read at render; a Convex update or a page visit re-renders it, no ticking clock.
    const stale = embedQueuedAt !== undefined && Date.now() - embedQueuedAt > STALE_MS;
    return (
      <div className="flex flex-col gap-1 text-sm text-muted">
        <p>Getting the Bandcamp player…</p>
        {stale && <p>Older than 10 minutes: the ingest worker may be down.</p>}
      </div>
    );
  }
  if (embedState === "failed") {
    const again = async () => {
      setRetry({ busy: true, error: null });
      try {
        await onRetry();
        setRetry({ busy: false, error: null });
      } catch (e) {
        setRetry({ busy: false, error: errorText(e) });
      }
    };
    return (
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">No player: {embedErrorText(embedError)}</span>
          <button type="button" className={SECONDARY} disabled={retry.busy} onClick={again}>Try again</button>
        </div>
        {retry.error && <p role="alert" className="text-problem-text">{retry.error}</p>}
      </div>
    );
  }
  if (!embed || embedState === undefined) return null; // ready, or queued for a re-read with the id it already had
  const src = playerSrc(embed);
  if (!src) return <p className="text-sm text-ink-soft">No player: {embedErrorText("bad_id")}</p>;
  if (!playing)
    return (
      <button type="button" className={`${SECONDARY} self-start`} onClick={() => setPlaying(true)}>
        Play on Bandcamp
      </button>
    );
  return (
    <iframe
      src={src}
      title={`Bandcamp player: ${artist} – ${title}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-popups"
      width="100%"
      height="120"
      className="block w-full rounded-control border border-line"
    />
  );
}
