"use client";

import { bookmarkletCode } from "@aircheck/core";
import { useEffect, useRef } from "react";
import { PRIMARY } from "./EpisodeControls";

// Oct 30: the "Send to Air Check" bookmarklet (core bookmarkletCode). React blocks javascript: hrefs, so the href is set on
// the element after it mounts. It runs in Tarik's browser on a Bandcamp page; Air Check never fetches Bandcamp (decision 025).

export function BookmarkletLink() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute("href", bookmarkletCode(window.location.origin));
  }, []);
  return (
    <a ref={ref} href="#" onClick={(e) => e.preventDefault()} className={`${PRIMARY} self-start`}>
      Send to Air Check
    </a>
  );
}

/** Settings and the attach page: the button and how to install it. Real workspace only (the demo has no players). */
export function BookmarkletSetup({ boxed = false }: { boxed?: boolean }) {
  const body = (
    <>
      <p className="text-sm">Drag this button to your bookmarks bar. On a Bandcamp album or track page, click it: Air Check opens with that release&apos;s player and cover ready to attach.</p>
      <BookmarkletLink />
      <p className="text-[12.5px] text-muted">It reads only the page you have open, in your browser. Air Check never visits Bandcamp itself. Bookmarks bar hidden? Cmd+Shift+B in Chrome.</p>
    </>
  );
  return boxed ? (
    <section aria-labelledby="bookmarklet-h" className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <h2 id="bookmarklet-h" className="text-base font-semibold">Bandcamp players and covers</h2>
      {body}
    </section>
  ) : (
    <section className="flex flex-col gap-3">{body}</section>
  );
}
