import { expect, test } from "vitest";
import {
  episodeStatus,
  formatTrack,
  nextAudioToFetch,
  nextToDraft,
  parsePaperExport,
  parseTracklist,
  reconcile,
  showDateFromTitle,
  type EpisodeFacts,
} from "../src/index";
import { readFixture } from "./helpers/fixtures";

const ep = (showDate: string, o: Partial<EpisodeFacts> = {}): EpisodeFacts => ({
  showDate,
  audio: { status: "ready" },
  tracklist: { status: "found" },
  notes: { status: "found" },
  questions: [],
  packageStatus: "none",
  ...o,
});

test("status: ready, with notes missing only a gap", () => {
  expect(episodeStatus(ep("2026-10-02"))).toEqual({ status: "ready-to-draft", gaps: [] });
  expect(episodeStatus(ep("2026-10-02", { notes: { status: "missing" } }))).toEqual({
    status: "ready-to-draft",
    gaps: ["notes"],
  });
});

test("status: missing audio / tracklist block drafting", () => {
  expect(episodeStatus(ep("d", { audio: { status: "none" } })).status).toBe("missing-audio");
  expect(episodeStatus(ep("d", { audio: { status: "incomplete" } })).status).toBe("missing-audio");
  const r = episodeStatus(ep("d", { tracklist: { status: "missing" }, notes: { status: "missing" } }));
  expect(r).toEqual({ status: "missing-tracklist", gaps: ["tracklist", "notes"] });
});

test("status: questions block until answered; audio ask is a question", () => {
  const open = { id: "q1", text: "?" };
  expect(episodeStatus(ep("d", { questions: [open] })).status).toBe("question");
  expect(episodeStatus(ep("d", { audio: { status: "ask" } })).status).toBe("question");
  expect(episodeStatus(ep("d", { questions: [{ ...open, answer: "yes" }] })).status).toBe("ready-to-draft");
});

test("status: package status wins", () => {
  const s = (p: EpisodeFacts["packageStatus"]) => episodeStatus(ep("d", { packageStatus: p })).status;
  expect(s("preparing_audio")).toBe("drafting");
  expect(s("awaiting_review")).toBe("awaiting-review");
  expect(s("approved")).toBe("approved");
  expect(s("publishing")).toBe("approved");
  expect(s("succeeded")).toBe("published");
  expect(s("failed")).toBe("failed");
  expect(s("outcome_unknown")).toBe("outcome-unknown");
  expect(s("skipped")).toBe("skipped");
});

test("nextAudioToFetch: oldest first, stops at max, skips questions and ask/incomplete", () => {
  const eps = [
    ep("2026-03-01", { audio: { status: "ask" } }),
    ep("2026-02-01", { audio: { status: "incomplete" } }),
    ep("2026-04-01", { questions: [{ id: "q", text: "?" }] }),
    ep("2026-06-01"),
    ep("2026-05-01", { audioOnDisk: true }),
    ep("2026-05-08"),
  ];
  expect(nextAudioToFetch(eps, 0)?.showDate).toBe("2026-05-08");
  expect(nextAudioToFetch(eps, 2)?.showDate).toBe("2026-05-08");
  expect(nextAudioToFetch(eps, 3)).toBeNull();
  expect(nextAudioToFetch([], 0)).toBeNull();
});

test("nextAudioToFetch: also covers drafting and awaiting-review shows", () => {
  const eps = [ep("2026-02-01", { packageStatus: "awaiting_review" }), ep("2026-01-01", { packageStatus: "succeeded" })];
  expect(nextAudioToFetch(eps, 0)?.showDate).toBe("2026-02-01");
});

test("nextToDraft: oldest ready-to-draft, none when 3 await review", () => {
  const eps = [
    ep("2026-02-01", { packageStatus: "awaiting_review" }),
    ep("2026-03-01", { questions: [{ id: "q", text: "?" }] }),
    ep("2026-05-01"),
    ep("2026-04-01"),
  ];
  expect(nextToDraft(eps, 0)?.showDate).toBe("2026-04-01");
  expect(nextToDraft(eps, 2)?.showDate).toBe("2026-04-01");
  expect(nextToDraft(eps, 3)).toBeNull();
});

test("dates: known quirks", () => {
  const ok = (s: string) => showDateFromTitle(s);
  expect(ok("Rhythm Lab Radio 10-2-26")).toEqual({ ok: true, date: "2026-10-02" });
  expect(ok("Rhythm Lab Radio 10–02-26")).toEqual({ ok: true, date: "2026-10-02" });
  expect(ok("Rhythm Lab Radio 10-2-2026")).toEqual({ ok: true, date: "2026-10-02" });
  expect(ok("Rhythm Lab Radio 9-4-26 (evergreen)")).toEqual({ ok: true, date: "2026-09-04" });
  expect(ok("10-02-26")).toEqual({ ok: true, date: "2026-10-02" });
});

test("dates: typo and junk are refused with a reason, not guessed", () => {
  for (const s of ["Rhythm Lab Radio 9-4-226", "Rhythm Lab Radio", "RLR 13-45-26", "2-30-26"]) {
    const r = showDateFromTitle(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
  }
});

test("paper: synthesized H<hour> | Artist | Title fixture", () => {
  const r = parsePaperExport(readFixture("raw/10-2-26-paper-tracks.txt"));
  expect(r.tracks).toHaveLength(29);
  expect(r.tracks.filter((t) => t.hour === 1)).toHaveLength(14);
  expect(r.tracks[0]).toEqual({ hour: 1, artist: "Walter Bishop, Jr.", title: "N'Dugu's Prayer" });
  expect(r.unreadable).toBe(false);
});

test("paper: Drive + Paper reconcile to the golden 31 tracks", () => {
  const paper = parsePaperExport(readFixture("raw/10-2-26-paper-tracks.txt")).tracks;
  const r = reconcile(parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt")), paper);
  expect(r.tracks).toHaveLength(31);
  expect(r.tracks.filter((t) => t.hour === 1)).toHaveLength(15);
  expect(r.tracks.filter((t) => t.hour === 2)).toHaveLength(16);
  expect(r.tracks.filter((t) => t.status === "closing-track").map((t) => t.hour)).toEqual([1, 2]);
  expect(r.questions).toEqual([]);
  expect(r.tracks.map(formatTrack)).toContain('Saigon Soul Revival - "Lý Qua Dub"');
});

const REAL = `# Rhythm Lab Radio 10-16-26
# Rhythm Lab Radio, Hour One: Show Notes
Intro prose. Hour One closes with a final track.
## Show Thread
- **Thread:** a link [[site](https://example.com)]
----------
## 1. Artist One – "First Song"
**Release:** Album, Label [[site](https://example.com)]
### Details:
- fact [[site](https://example.com)]
- **[verify]** thin
## 2. Artist Two & Guest — "Second Song"
## 3. Not A Track Line
# Rhythm Lab Radio, Hour Two: Full Show Notes
## Show Threads
## 1. Artist Three - "Third Song" (feat. Someone)
`;

test("paper: real show-notes structure (headings, en dash, links ignored)", () => {
  const r = parsePaperExport(REAL);
  expect(r.tracks).toEqual([
    { hour: 1, artist: "Artist One", title: "First Song" },
    { hour: 1, artist: "Artist Two & Guest", title: "Second Song" },
    { hour: 2, artist: "Artist Three", title: "Third Song" },
  ]);
  expect(r.unreadable).toBe(false);
});

test("paper: the real format fixture file parses to its one placeholder track", () => {
  expect(parsePaperExport(readFixture("show-notes-format.md")).tracks).toEqual([
    { hour: 1, artist: "Artist", title: "Title" },
  ]);
});

test("paper: plain text with HOUR markers, and never guesses", () => {
  const r = parsePaperExport('HOUR 1\n1. A – "One"\nsome prose – "quoted"\nHOUR TWO\n1. B - "Two"\nno quote here - Three');
  expect(r.tracks).toEqual([
    { hour: 1, artist: "A", title: "One" },
    { hour: 2, artist: "B", title: "Two" },
  ]);
});

test("paper: track lines before any hour heading are ignored", () => {
  expect(parsePaperExport('## 1. A – "One"').tracks).toEqual([]);
});

test("paper: non-empty doc with zero tracks is flagged; empty is not", () => {
  expect(parsePaperExport("Just some prose, no hours.")).toEqual({ tracks: [], unreadable: true });
  expect(parsePaperExport("  \n")).toEqual({ tracks: [], unreadable: false });
});

test("skipped episodes are never picked for audio or drafting", () => {
  const eps = [ep("2026-01-01", { packageStatus: "skipped" })];
  expect(nextAudioToFetch(eps, 0)).toBeNull();
  expect(nextToDraft(eps, 0)).toBeNull();
  expect(nextToDraft([...eps, ep("2026-02-01")], 0)?.showDate).toBe("2026-02-01");
});
