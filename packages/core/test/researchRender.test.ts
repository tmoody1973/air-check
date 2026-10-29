import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deepDiveMarkdown, type DeepDiveView, notesForDraft, numberLines, showNotesMarkdown, verifyReport, type VerifyView } from "../src/index";
import { sampleView } from "./helpers/researchSample";

const golden = readFileSync(new URL("../../../fixtures/show-notes-sample.md", import.meta.url), "utf8");
const link = { url: "https://example.org/x", host: "example.org", title: "[Page x]", via: "tavily", primary: false, matched: true };

describe("showNotesMarkdown", () => {
  it("renders the sample view byte for byte as fixtures/show-notes-sample.md", () => {
    expect(showNotesMarkdown(sampleView)).toBe(golden);
  });

  it("marks an embargo set on the track itself, and a private block", () => {
    const view = {
      ...sampleView,
      embargoes: [],
      tracks: sampleView.tracks.map((t) => (t.key === "H1.2" ? { ...t, embargo: { until: "2026-11-06" } } : t)),
      entries: sampleView.entries.map((e) => (e.key === "H1.1" ? { ...e, private: { by: "tarik" as const } } : e)),
    };
    const md = showNotesMarkdown(view);
    expect(md).toContain('## 2. [Artist B] – "[Title B]"\n\n**PRIVATE · embargoed until Nov 6, 2026**');
    expect(md).toContain('## 1. [Artist A] – "[Title A]"\n\n**PRIVATE**\n');
    expect(md).not.toContain("embargoed (date not known)");
  });

  it("leaves out angles when they are off, and shows Tarik's edit in place of the block", () => {
    const view = { ...sampleView, angles: false, entries: sampleView.entries.map((e) => (e.key === "H2.1" ? { ...e, edited: { text: "My own words." } } : e)) };
    const md = showNotesMarkdown(view);
    expect(md).not.toContain("On-air angle");
    expect(md).toContain('## 1. [Artist D] – "[Title D]"\n\n**PRIVATE · embargoed (date not known)**\n\nMy own words.\n\n## 2.');
    expect(md).not.toContain("It came out on [Label D].");
  });

  it("drops every PRIVATE marker line in the agent copy (R8), and keeps the rest", () => {
    const md = showNotesMarkdown(sampleView, { forAgent: true });
    expect(md).not.toMatch(/PRIVATE|embargoed|2026-11-06/);
    expect(md).toBe(golden.replace(/\*\*PRIVATE[^\n]*\*\*\n\n/g, "").replace(/ · PRIVATE/g, ""));
  });

  it("drops a sentence of Tarik's edit that names an embargoed release from the agent copy only (R8)", () => {
    const view = { ...sampleView, entries: sampleView.entries.map((e) => (e.key === "H1.1" ? { ...e, edited: { text: "A fine sentence. Ahead of [Title B] next month." } } : e)) };
    expect(showNotesMarkdown(view)).toContain("A fine sentence. Ahead of [Title B] next month.");
    const agent = showNotesMarkdown(view, { forAgent: true });
    expect(agent).toContain("A fine sentence.");
    expect(agent).not.toContain("Ahead of");
  });

  it("marks a recent release of an embargoed track as private in the Show Thread", () => {
    const view = {
      ...sampleView,
      entries: sampleView.entries.map((e) =>
        e.key === "H1.2" ? { ...e, claims: [{ kind: "release-date" as const, text: "Out 2026-10-20.", value: "2026-10-20", status: "confirmed" as const, sources: [link] }] } : e,
      ),
    };
    expect(showNotesMarkdown(view)).toContain('[Artist B] – "[Title B]" released 10 days before the show (Oct 20, 2026) [[example.org](https://example.org/x)] · PRIVATE');
    expect(showNotesMarkdown(view, { forAgent: true })).not.toContain("PRIVATE");
  });
});

describe("notesForDraft (Review Focus 5)", () => {
  it("keeps only confirmed and sourced claims, with no embargoed, private, [verify] or angle text", () => {
    const text = notesForDraft(sampleView);
    expect(text).toBe('[Artist A] – "[Title A]": [Title A] is the lead single from [Album A]. [Title A] is on [Label A]. [Title A] came out on 2026-10-16. [Artist A] co-produced the track with [Producer]. [Artist A] is a bassist from [City].');
    expect(text).not.toMatch(/\[Artist B\]|\[Title B\]|\[Artist D\]|verify|Producer\] bring|supplied|late-night|https?:/);
  });

  it("drops a private block, and keeps a thread that names no embargoed release", () => {
    const view = {
      ...sampleView,
      entries: sampleView.entries.map((e) =>
        e.key === "H1.1" ? { ...e, private: { by: "agent" as const, reason: "personal" } } : e.key === "H1.threads" ? { ...e, claims: e.claims.map((c) => ({ ...c, text: "[Artist A] and [Artist C] share a drummer." })) } : e,
      ),
    };
    expect(notesForDraft(view)).toBe("[Artist A] and [Artist C] share a drummer.");
  });

  it("splits sentences without breaking on abbreviations", () => {
    const view = { ...sampleView, entries: sampleView.entries.map((e) => (e.key === "H1.threads" ? { ...e, claims: e.claims.map((c) => ({ ...c, text: "[Artist A] worked with Dr. [Title B] Jones, e.g. on tour. They share a drummer." })) } : e)) };
    expect(notesForDraft(view).split("\n")[0]).toBe("They share a drummer.");
  });

  it("treats an undated embargo as active", () => {
    const view = { ...sampleView, embargoes: [{ artist: "[Artist A]", title: "[Title A]", until: null }] };
    expect(notesForDraft(view)).not.toContain("[Title A]");
  });
});

describe("verifyReport", () => {
  const notes = '## 1. Álvaro – “Café”\n- “Café” came out on Oct 10 2026 on Brownswood Recordings.\n## 2. Closer – "End"\n- Closing line.';
  const tracks = [
    { key: "H1.1", hour: 1 as const, position: 1, artist: "Alvaro", title: "Cafe", closing: false },
    { key: "H1.2", hour: 1 as const, position: 2, artist: "Closer", title: "End", closing: true },
  ];
  const view: VerifyView = {
    lines: numberLines(notes, tracks),
    tracks,
    entries: [
      {
        key: "L2",
        claims: [
          { kind: "release-date", text: "It came out on 2026-10-17.", value: "2026-10-17", status: "confirmed", sources: [link, { ...link, url: "https://example.org/y" }] },
          { kind: "label", text: "On Brownswood.", value: "Brownswood", status: "sourced", sources: [link] },
        ],
        replacement: "“Café” came out on October 17, 2026 on Brownswood Recordings.",
      },
      {
        key: "L1",
        claims: [{ kind: "release-date", text: "It came out on 2026-10-03.", value: "2026-10-03", status: "could-not-verify", sources: [{ ...link, url: "https://www.discogs.com/release/1", host: "www.discogs.com" }], check: "Only one source: discogs.com" }],
        replacement: "Álvaro released “Café” on October 3, 2026.",
      },
      { key: "L4", claims: [], replacement: "Never shown." },
    ],
  };

  it("offers a replacement only for a line whose claims all hold; a one-source Discogs line stays open", () => {
    const r = verifyReport(view);
    expect(r.changes).toEqual([
      {
        lineId: "L2",
        original: "- “Café” came out on Oct 10 2026 on Brownswood Recordings.",
        replacement: "“Café” came out on October 17, 2026 on Brownswood Recordings. [[example.org](https://example.org/x)] [[example.org](https://example.org/y)]",
      },
    ]);
    expect(r.open).toEqual(["L1: It came out on 2026-10-03. — Only one source: discogs.com"]);
  });
});

describe("deepDiveMarkdown", () => {
  const tracks = [
    { key: "H1.1", hour: 1 as const, position: 1, artist: "[Artist A]", title: "[Title A]", closing: false },
    { key: "H1.2", hour: 1 as const, position: 2, artist: "[Artist B]", title: "[Title B]", closing: true },
  ];
  const base: DeepDiveView = {
    subject: { type: "label", name: "[Label A]" },
    tracks,
    entry: {
      key: "brief",
      claims: [
        { kind: "detail", text: "[Label A] started in [City].", status: "sourced", sources: [link] },
        { kind: "connection", text: "[Artist A] recorded for [Label A].", value: "H1.1", status: "sourced", sources: [link] },
        { kind: "connection", text: "A closing-track link.", value: "H1.2", status: "sourced", sources: [link] },
        { kind: "label", text: "[Label A] is part of [Group].", value: "[Group]", status: "could-not-verify", sources: [link], check: "Only one source: example.org" },
      ],
    },
    pastShows: { count: 3, year: 2026, last: "2026-10-16" },
  };

  it("renders facts, connections by track name, what could not be verified, and the code-written past-shows line", () => {
    expect(deepDiveMarkdown(base)).toBe(
      [
        "# Deep dive: [Label A]",
        "",
        "- [Label A] started in [City]. [[example.org](https://example.org/x)]",
        "",
        "## Connects to your list",
        "",
        '- **[Artist A] – "[Title A]":** [Artist A] recorded for [Label A]. [[example.org](https://example.org/x)]',
        "",
        "## Could not verify",
        "",
        "- **[verify]** [Label A] is part of [Group]. — Only one source: example.org [[example.org](https://example.org/x)]",
        "",
        "On Rhythm Lab: 3 shows in 2026, last Oct 16, 2026",
        "",
      ].join("\n"),
    );
  });

  it("never asserts zero past shows (R10: a zero cannot be known), and marks an embargoed subject", () => {
    const md = deepDiveMarkdown({ ...base, pastShows: { count: 0, year: 2026 }, embargo: { until: null } });
    expect(md).not.toMatch(/No past shows|On Rhythm Lab/);
    expect(md).toContain("# Deep dive: [Label A]\n\n**PRIVATE · embargoed (date not known)**\n");
  });
});
