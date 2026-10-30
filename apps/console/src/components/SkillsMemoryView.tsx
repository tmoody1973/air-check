"use client";

import type { StationSkill } from "@aircheck/core";

// Oct 30: Skills and memory. What the agent works from (the station skills, readable files from skills/*/SKILL.md),
// what Air Check keeps from Tarik's own fixes, passes and edits (memory.learned), and what the agent itself remembers.
// Read only. Skills change through a reviewed update; the agent cannot write its own (locked Oct 28).

export type Learned = {
  counts: { fixes: number; passes: number; releaseEdits: number; researchEdits: number };
  fixes: { showDate: string; parts: string[]; at: number }[];
  passes: { artist: string; title: string; reason: string; at: number }[];
  releaseEdits: { artist: string; title: string; fields: string[] }[];
  researchEdits: { label: string; key: string; at: number }[];
};

const CARD = "flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-5";
const H2 = "font-serif text-[22px] leading-tight";
const FIELD_WORD: Record<string, string> = { artist: "artist", title: "title", label: "label", type: "type", releasedOn: "release date", genre: "genre", embargo: "embargo" };

function List<T>({ title, count, items, empty, line }: { title: string; count: number; items: T[]; empty: string; line: (x: T) => string }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-semibold">
        {title} <span className="font-normal tabular-nums text-muted">· {count}</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {items.map((x, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">{line(x)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SkillsMemoryView({ skills, learned, workspace }: { skills: readonly StationSkill[]; learned: Learned | null | undefined; workspace: "real" | "demo" | null }) {
  const installed = skills.filter((s) => s.installed).length;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="skills-h" className={CARD}>
        <h2 id="skills-h" className={H2}>Skills</h2>
        <p className="text-sm text-ink-soft">
          The written instructions the agent works from: {skills.length} station skills, {installed} installed in the agent. Each is a plain file in the
          project. They change only through a reviewed update: since Oct 28 the agent cannot write or rewrite its own skills.
        </p>
        <ul className="flex flex-col gap-2">
          {skills.map((s) => (
            <li key={s.name} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
              <details>
                <summary className="cursor-pointer list-none">
                  <span className="font-mono text-[13px] font-medium">{s.name}</span>
                  {s.installed && <span className="ml-2 rounded-full bg-chip px-2 py-0.5 text-[11px] text-ink-soft">installed</span>}
                  <span className="mt-0.5 block text-sm text-ink-soft [overflow-wrap:anywhere]">{s.description}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">{s.where}</span>
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-surface-quiet p-3 text-[12px] leading-relaxed [overflow-wrap:anywhere]">{s.text}</pre>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="learned-h" className={CARD}>
        <h2 id="learned-h" className={H2}>What Air Check learned from you</h2>
        <p className="text-sm text-ink-soft">
          Your own fixes, choices and edits, kept and used the next time: a fixed show is scanned with your fix, a block you edited stays yours
          (unless you ask to regenerate it), and an edited release field stays yours when the same release arrives again.
        </p>
        {learned === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : learned === null ? (
          <p className="text-sm text-muted">Sign in to see this.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <List title="Show fixes" count={learned.counts.fixes} items={learned.fixes} empty={workspace === "demo" ? "The demo has no station shows." : "No fixes yet."} line={(f) => `${f.showDate}: ${f.parts.join(", ") || "fixed"}`} />
            <List title="Releases you passed on, and why" count={learned.counts.passes} items={learned.passes} empty="No passes with a reason yet." line={(p) => `${p.artist} – ${p.title}: “${p.reason}”`} />
            <List title="Release details you corrected" count={learned.counts.releaseEdits} items={learned.releaseEdits} empty="No corrections yet." line={(r) => `${r.artist} – ${r.title}: ${r.fields.map((f) => FIELD_WORD[f] ?? f).join(", ")}`} />
            <List title="Research you rewrote" count={learned.counts.researchEdits} items={learned.researchEdits} empty="No edited research blocks yet." line={(e) => `${e.label} · ${e.key}`} />
          </div>
        )}
      </section>

      <section aria-labelledby="memory-h" className={CARD}>
        <h2 id="memory-h" className={H2}>The agent&apos;s own memory</h2>
        {workspace === "demo" ? (
          <p className="text-sm text-ink-soft">Off in the demo. The demo agent remembers nothing between visitors, so no one sees what another visitor typed.</p>
        ) : (
          <p className="text-sm text-ink-soft">
            On for the station agent: Hermes keeps short notes between conversations (who Tarik is, how he likes things). It never holds account
            logins, and the release radar&apos;s emails never reach it, only finished records.
          </p>
        )}
      </section>
    </div>
  );
}
