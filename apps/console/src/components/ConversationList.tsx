"use client";

import Link from "next/link";
import { useState } from "react";

export type ConversationRow = { _id: string; title: string };

/** Always visible from 900px; below that it folds into a "Conversations" disclosure above the thread. */
export function ConversationList({ conversations, activeId }: { conversations: ConversationRow[] | undefined; activeId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Conversations" className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="conversation-list"
        onClick={() => setOpen((o) => !o)}
        className="min-h-11 rounded-control border border-line-strong bg-surface px-4 text-left text-sm font-medium min-[900px]:hidden"
      >
        Conversations
      </button>
      <div id="conversation-list" className={`${open ? "block" : "hidden"} min-[900px]:block`}>
        <h2 className="mb-2 hidden font-mono text-xs tracking-[0.1em] text-muted uppercase min-[900px]:block">Recent</h2>
        {conversations === undefined && <p className="text-sm text-muted">Loading…</p>}
        {conversations?.length === 0 && <p className="text-sm text-muted">No conversations yet.</p>}
        <ul className="flex flex-col gap-0.5">
          {conversations?.map((c) => (
            <li key={c._id}>
              <Link
                href={`/chat/${c._id}`}
                aria-current={c._id === activeId ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-control px-3 text-sm [overflow-wrap:anywhere] ${c._id === activeId ? "bg-surface font-medium" : "text-ink-soft"}`}
              >
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
