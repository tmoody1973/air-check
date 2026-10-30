// Test-only research.get rows (placeholders and example.org only).
import type { JudgedClaim } from "@aircheck/core";
import type { ResearchEntryRow, ResearchTrackRow, ResearchView } from "@/lib/research";

export const TODAY = "2026-10-29";

export const src = (path: string, host = "example.org") => ({
  url: `https://${host}/${path}`, host, title: `[Page ${path}]`, via: "tavily", primary: false, matched: true,
});
export const claim = (c: Partial<JudgedClaim> & Pick<JudgedClaim, "text">): JudgedClaim => ({
  kind: "detail", status: "sourced", sources: [src("a")], ...c,
});
export const entry = (key: string, e: Partial<ResearchEntryRow> = {}): ResearchEntryRow =>
  ({ key, block: key.endsWith(".intro") ? "intro" : key.endsWith(".threads") ? "threads" : key.startsWith("L") ? "line" : key === "brief" ? "brief" : "track", claims: [], savedAt: 1, updatedAt: 1, ...e }) as ResearchEntryRow;

export const TRACKS: ResearchTrackRow[] = [
  { key: "H1.1", hour: 1, position: 1, artist: "[Artist A]", title: "[Title A]", closing: false },
  { key: "H1.2", hour: 1, position: 2, artist: "[Artist B]", title: "[Title B]", closing: false, embargo: { until: "2026-11-07" } },
  { key: "H1.3", hour: 1, position: 3, artist: "[Artist C]", title: "[Title C]", closing: false },
  { key: "H1.4", hour: 1, position: 4, artist: "[Artist D]", title: "[Title D]", closing: true },
  { key: "H2.1", hour: 2, position: 1, artist: "[Artist E]", title: "[Title E]", closing: false, embargo: { until: null } },
  { key: "H2.2", hour: 2, position: 2, artist: "[Artist F]", title: "[Title F]", closing: true },
];

const job = (over: Partial<ResearchView["job"]> = {}): ResearchView["job"] =>
  ({ workspace: "real", jobId: "rj-abc123", kind: "show-notes", showDate: "2026-10-30", angles: true, status: "running", runIds: ["run-1"], continuations: 0, createdAt: 1, updatedAt: 1, tracks: TRACKS, ...over }) as ResearchView["job"];

export function notesView(over: Partial<ResearchView> = {}, jobOver: Partial<ResearchView["job"]> = {}): ResearchView {
  return {
    job: job(jobOver),
    tracks: TRACKS,
    entries: [
      entry("H1.intro", { intro: "The hour moves from [Artist A] into older label cuts." }),
      entry("H1.threads", { claims: [claim({ kind: "thread", text: "[Artist A] and [Artist B] both recorded at [Studio].", sources: [src("studio")] })] }),
      entry("H1.1", {
        claims: [
          claim({ kind: "label", text: "[Title A] is on [Label A].", value: "[Label A]", status: "confirmed", sources: [src("a1", "musicbrainz.org"), src("a2", "label-a.bandcamp.com")] }),
          claim({
            kind: "release-date", text: "[Title A] came out on 2026-10-16.", value: "2026-10-16", status: "conflict",
            sources: [{ ...src("a3"), says: "2026-10-16" }, { ...src("a4", "discogs.com"), says: "2026-10-23" }], check: "Sources disagree: 2026-10-16 (example.org) vs 2026-10-23 (discogs.com)",
          }),
          claim({ kind: "bio", text: "[Artist A] is a bassist from [City].", sources: [src("a5", "en.wikipedia.org")] }),
        ],
        angle: "What does [Producer] bring to the low end here?",
        suppliedNote: "[Label A]'s one-sheet calls it a late-night record.",
      }),
      entry("H1.2", { claims: [claim({ text: "[Artist B] recorded it in one take." })] }),
    ],
    sample: false,
    progress: { done: 4, total: 8 },
    secondsLeft: 170,
    activeRunId: "run-1",
    lastStep: "checking label on Discogs…",
    ...over,
  } as ResearchView;
}

export function verifyView(over: Partial<ResearchView> = {}): ResearchView {
  const lines = [
    { id: "L1", text: "## 1. [Artist A] – \"[Title A]\"", trackKey: "H1.1", closing: false },
    { id: "L2", text: "Out Oct 9 on [Label A].", trackKey: "H1.1", closing: false },
    { id: "L3", text: "Recorded in [City].", trackKey: "H1.2", closing: false },
    { id: "L4", text: "Closing track line.", trackKey: "H1.4", closing: true },
  ];
  return {
    job: job({ kind: "verify", status: "done", lines, angles: false, playContext: [{ artist: "[Artist A]", station: "88nine", lastPlayed: "2026-10-02" }] }),
    tracks: TRACKS,
    entries: [
      entry("L2", { claims: [claim({ kind: "release-date", text: "Out Oct 16 on [Label A].", value: "2026-10-16", status: "confirmed", sources: [src("a1"), src("a2", "discogs.com")] })], replacement: "Out Oct 16 on [Label A]." }),
      entry("L3", { claims: [claim({ kind: "detail", text: "Recorded in [City].", status: "could-not-verify", sources: [src("b1")], check: "Only one source: example.org" })] }),
    ],
    sample: false,
    progress: { done: 2, total: 3 },
    ...over,
  } as ResearchView;
}

export function deepDiveView(facts: number, over: Partial<ResearchView> = {}): ResearchView {
  const claims: JudgedClaim[] = [
    ...Array.from({ length: facts }, (_, i) => claim({ text: `Fact ${i + 1} about [Artist A].`, sources: [src(`f${i}`)] })),
    claim({ kind: "connection", text: "Shares a producer with this track.", value: "H1.3", sources: [src("c1")] }),
    claim({ kind: "connection", text: "Never shown: a closing track.", value: "H1.4", sources: [src("c2")] }),
    claim({ kind: "credit", text: "Played bass on [Album X].", status: "could-not-verify", sources: [src("x1")], check: "Only one source: example.org" }),
  ];
  return {
    job: job({ kind: "deep-dive", status: "done", subject: { type: "artist", name: "[Artist A]" }, angles: false }),
    tracks: TRACKS,
    entries: [entry("brief", { claims, note: "Two of the interviews are from the same tour." })],
    sample: false,
    progress: { done: 1, total: 1 },
    ...over,
  } as ResearchView;
}
