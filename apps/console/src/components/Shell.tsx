"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { NAV } from "../lib/nav";
import { ALLOWED_DESTINATIONS } from "../lib/sandbox";
import { Pill } from "./Pill";

export type Workspace = "demo" | "real";

// The (console) layout reads the session on the server and supplies this; display only.
const WorkspaceContext = createContext<Workspace>("real");
export const WorkspaceProvider = WorkspaceContext.Provider;
export const useWorkspace = () => useContext(WorkspaceContext);

function Logo() {
  return (
    <span className="flex items-center gap-2.5 px-2">
      <svg width="28" height="22" viewBox="0 0 36 28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true" className="text-signal">
        <path d="M3 14v0M9 8v12M15 3v22M21 9v10M27 5v18M33 12v4" />
      </svg>
      <span className="font-serif text-[26px] leading-none">Air Check</span>
    </span>
  );
}

export function Shell({
  title,
  children,
  workspace,
  active,
}: {
  title: string;
  children: ReactNode;
  workspace?: Workspace;
  /** Nav slug; defaults to the current path (Today = /today, others = /soon/<slug>). */
  active?: string;
}) {
  const pathname = usePathname();
  const ctx = useContext(WorkspaceContext);
  const ws = workspace ?? ctx;
  const [open, setOpen] = useState(false);
  const current = active ?? NAV.find((n) => pathname === n.href || pathname?.startsWith(`${n.href}/`))?.slug;

  return (
    <div className="min-h-screen bg-paper text-ink min-[900px]:flex">
      <aside className="flex flex-col gap-5 border-b border-line bg-sidebar px-4 py-3 min-[900px]:min-h-screen min-[900px]:w-64 min-[900px]:shrink-0 min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:py-5">
        <div className="flex items-center justify-between">
          <Logo />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="sidebar-body"
            onClick={() => setOpen((o) => !o)}
            className="min-h-11 rounded-control border border-line-strong bg-surface px-4 text-sm font-medium min-[900px]:hidden"
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <div id="sidebar-body" className={`${open ? "flex" : "hidden"} flex-1 flex-col gap-5 min-[900px]:flex`}>
          <Link
            href="/soon/chat"
            className="flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-3.5 text-sm font-medium"
          >
            <span aria-hidden="true">+</span> New conversation
          </Link>
          <nav aria-label="Workspace" className="flex flex-col gap-0.5">
            {NAV.map((n) => {
              const isActive = n.slug === current;
              return (
                <Link
                  key={n.slug}
                  href={n.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-control px-3 text-sm ${
                    isActive ? "bg-surface font-semibold text-ink" : "text-ink-soft hover:bg-chip"
                  }`}
                >
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${isActive ? "bg-signal" : "bg-line-strong"}`} />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          {ws === "demo" && (
            <div className="mt-auto flex flex-col gap-1.5 rounded-control bg-caution-bg p-3 text-[13px] leading-snug text-caution-text">
              <strong className="font-semibold">Demo workspace</strong>
              Sample data. Publishing to Mixcloud is switched off.
            </div>
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 min-[900px]:px-8">
          <h1 className="font-serif text-[28px] font-normal leading-tight">{title}</h1>
          <div className="flex flex-wrap gap-2">
            <Pill tone="neutral">
              <span aria-hidden="true" className="size-2 rounded-full bg-signal" />
              Sandbox on
            </Pill>
            <Pill tone="neutral">{`${ALLOWED_DESTINATIONS.length} destinations allowed`}</Pill>
          </div>
        </header>
        <div className="px-4 py-6 min-[900px]:px-8">{children}</div>
      </main>
    </div>
  );
}
