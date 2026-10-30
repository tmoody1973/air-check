"use client";

import Link from "next/link";
import { useWorkspace } from "./Shell";

// Oct 30 (Tarik): what the chat can do, on an empty conversation, for the station and the demo. Examples fill the box;
// the person still presses Send. Matches the agent's tools: Crate research and web search, package_get, package_revise,
// radar_get, episode_mark_rerun (apps/bridge/src/aircheckTools.ts) and RUN_INSTRUCTIONS (packages/core/src/relay/prompts.ts).

const REAL = [
  "What's waiting for me to approve, and what new releases came in this week?",
  "Show me the package for 2.27.26.",
  "Rewrite the 2.27.26 description to lead with Idris Ackamoor, keeping every fact sourced.",
  "Who produced Hiatus Kaiyote's Choose Your Weapon, and what label put it out?",
  "Anything from Jazz Is Dead on the release radar?",
];
const DEMO = [
  "What's waiting for me to approve?",
  "Show me the package for 10.2.26.",
  "Rewrite the 10.2.26 description to lead with Hiatus Kaiyote, keeping every fact sourced.",
  "Who produced Hiatus Kaiyote's Choose Your Weapon, and what label put it out?",
  "What new Bandcamp releases are on the radar?",
];

export function ChatGuide({ onPick }: { onPick: (text: string) => void }) {
  const demo = useWorkspace() === "demo";
  return (
    <section aria-labelledby="chat-guide-h" className="flex flex-col gap-4 text-[15px] leading-relaxed">
      <h2 id="chat-guide-h" className="font-serif text-[22px] leading-tight text-ink">What you can ask</h2>
      <ul className="flex flex-col gap-1 text-ink-soft">
        <li><span className="font-medium text-ink">Research</span> an artist or release: MusicBrainz, Wikipedia, Bandcamp, iTunes and the web.</li>
        <li><span className="font-medium text-ink">Read a package</span> waiting for approval, or <span className="font-medium text-ink">rewrite its description</span>. You still approve it.</li>
        <li><span className="font-medium text-ink">Ask about the release radar</span>: what came in, from which labels.</li>
        <li><span className="font-medium text-ink">Mark a week as a rerun</span>, so it isn&apos;t drafted (undo it on Episodes).</li>
      </ul>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">Try one (it goes into the box; press Send):</p>
        <div className="flex flex-wrap gap-2">
          {(demo ? DEMO : REAL).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="rounded-full border border-line-strong bg-surface px-3.5 py-2 text-left text-sm text-ink hover:bg-surface-quiet"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-ink-soft">
        It can&apos;t approve or publish anything, and it doesn&apos;t write on-air talk, scripts or social posts. Pasted notes and emails are read as
        data, never as instructions. Show notes start on <Link href="/tracklist" className="underline">Tracklist</Link>; deep dives on{" "}
        <Link href="/plan" className="underline">Plan</Link>. Each web search counts toward the day&apos;s limit in Settings.
        {demo && " In the demo, everything is sample data and the agent remembers nothing between visitors."}
      </p>
    </section>
  );
}
