"use client";

import { type AttachPayload, bookmarkletCode, readAttachPayload } from "@aircheck/core";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PRIMARY, errorText } from "@/components/EpisodeControls";
import { Shell, useWorkspace } from "@/components/Shell";

// Oct 30: Bandcamp challenges the VM's page reads (decision 025), so the "Send to Air Check" bookmarklet reads the player,
// cover and address in Tarik's own browser and opens this page with them in the URL hash. The hash never reaches a server;
// every field is checked again here and in radar.pastePlayer.

/** The draggable bookmarklet. React blocks javascript: hrefs, so the href is set on the element after it mounts. */
function BookmarkletLink() {
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

function Install() {
  return (
    <section className="flex flex-col gap-3 text-sm">
      <p>Drag this button to your bookmarks bar. On a Bandcamp album or track page, click it: Air Check opens with that release&apos;s player and cover ready to attach.</p>
      <BookmarkletLink />
      <p className="text-ink-soft">It reads only the page you have open, in your browser. Air Check never visits Bandcamp itself.</p>
    </section>
  );
}

function Attach({ payload }: { payload: AttachPayload }) {
  const found = useQuery(api.radar.attachCandidates, { title: payload.title ?? "" });
  const paste = useMutation(api.radar.pastePlayer);
  const [state, setState] = useState<{ busy: string | null; done: string | null; error: string | null }>({ busy: null, done: null, error: null });
  const attach = async (releaseId: string, name: string) => {
    setState({ busy: releaseId, done: null, error: null });
    try {
      await paste({ releaseId: releaseId as Id<"releases">, pasted: payload.player, ...(payload.art && { art: payload.art }), ...(payload.page && { page: payload.page }) });
      setState({ busy: null, done: name, error: null });
    } catch (e) {
      setState({ busy: null, done: null, error: errorText(e) });
    }
  };
  return (
    <section className="flex flex-col gap-4 text-sm">
      <div className="flex items-center gap-3">
        {payload.art && <img src={payload.art} alt="" width={64} height={64} referrerPolicy="no-referrer" className="size-16 rounded-control border border-line object-cover" />}
        <p className="[overflow-wrap:anywhere]">From Bandcamp: <span className="font-medium">{payload.title ?? "this page"}</span></p>
      </div>
      {state.done ? (
        <p role="status">Attached to {state.done}. <Link href="/release-radar" className="underline">Back to the Release radar</Link></p>
      ) : found === undefined ? (
        <p className="text-ink-soft">Looking for the release…</p>
      ) : found.length === 0 ? (
        <p>No release on the radar matches this title. It may not have arrived by email yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {found.map((r) => {
            const name = `${r.artist} – ${r.title}`;
            return (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 first:border-t-0">
                <span className="[overflow-wrap:anywhere]">{name}{r.hasPlayer ? " (has a player)" : ""}</span>
                <button type="button" aria-label={`Attach to ${name}`} className={PRIMARY} disabled={state.busy !== null} onClick={() => attach(r._id, name)}>Attach</button>
              </li>
            );
          })}
        </ul>
      )}
      {state.error && <p role="alert" className="text-problem-text">{state.error}</p>}
    </section>
  );
}

export default function AttachPage() {
  const workspace = useWorkspace();
  const [payload, setPayload] = useState<AttachPayload | null | undefined>(undefined);
  useEffect(() => setPayload(readAttachPayload(window.location.hash)), []);
  return (
    <Shell title="Attach from Bandcamp">
      {workspace !== "real" ? (
        <p className="text-sm text-ink-soft">The demo has no Bandcamp players.</p>
      ) : payload === undefined ? null : payload ? (
        <Attach payload={payload} />
      ) : (
        <Install />
      )}
    </Shell>
  );
}
