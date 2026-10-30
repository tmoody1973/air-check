import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CitedSource, deepDiveMarkdown, type DeepDiveView, type JudgedClaim, notesForDraft, numberLines, showNotesMarkdown, verifyReport, type VerifyView } from "../src/index";
import { sampleView } from "./helpers/researchSample";

const golden = readFileSync(new URL("../../../fixtures/show-notes-sample.md", import.meta.url), "utf8");
const link = { url: "https://example.org/x", host: "example.org", title: "[Page x]", via: "tavily", primary: false, matched: true };

describe("showNotesMarkdown", () => {
  it("renders the sample view byte for byte as fixtures/show-notes-sample.md", () => {
    expect(showNotesMarkdown(sampleView)).toBe(golden);
  });

  it("Oct 29: shaped like his Paper notes: labeled bullets in his order, short link names, no per-hour count, no old headings", () => {
    const md = showNotesMarkdown(sampleView);
    const labels = [...md.split("### 1. [Artist A]")[1]!.split("### 2.")[0]!.matchAll(/^- \*\*([^*:]+):?\*\*/gm)].map((m) => m[1]);
    expect(labels).toEqual(["Album and label", "Chart", "Artist bio", "Story", "Samples and connections", "Video", "Fun fact", "On-air angle", "Supplied note"]);
    expect(md).toContain("[[en.example](https://en.example.org/a3)]");
    expect(md).not.toMatch(/marked \*\*\[verify\]\*\* had|Pre-Air Verify List|Show Thread|### Details|\*\*Artist:\*\*|I found no verified bio|Only one source: example\.org \[|----------/);
  });

  it("marker rules: a fact that holds has no marker; a conflict gives both versions then [verify]; the reason is only in the review", () => {
    const md = showNotesMarkdown(sampleView);
    expect(md).toContain("- **Artist bio:** [Artist A] is a bassist from [City].[[en.example](https://en.example.org/a3)]\n");
    expect(md).toContain("Sources disagree: example says Oct 10, 2026, news.example says Oct 17, 2026.[[example](https://www.example.org/b1)][[news.example](https://news.example.org/b2)] **[verify]**");
    const body = md.split("## Notes for Your Review")[0]!;
    expect(body).not.toMatch(/No source found|only one source|Only one source/i);
    expect(md.split("## Notes for Your Review")[1]).toContain("(no source found)");
  });

  it("an unsourced fact is kept, marked [verify], with no links", () => {
    expect(showNotesMarkdown(sampleView)).toContain("- **Chart:** [Title A] was a [Magazine] track of the week. **[verify]**\n");
  });

  it("a track with little that holds reads 'What I could verify' / 'What I couldn't verify'", () => {
    const view = { ...sampleView, entries: sampleView.entries.map((e) => (e.key === "H1.2" ? { ...e, claims: e.claims.slice(0, 1) } : e)) };
    expect(showNotesMarkdown(view)).toContain(
      "**PRIVATE · embargoed until Nov 6, 2026**\n\n- **What I could verify:** Nothing yet.\n- **What I couldn't verify:** I couldn't confirm the album and label or the artist's bio. [Title B] came out on 2026-10-10.",
    );
  });

  it("Notes for Your Review says 'Nothing to verify.' when nothing is flagged", () => {
    const view = { ...sampleView, entries: sampleView.entries.map((e) => ({ ...e, claims: e.claims.filter((c) => c.status === "sourced" || c.status === "confirmed") })) };
    expect(showNotesMarkdown(view)).toMatch(/## Notes for Your Review\n\nNothing to verify\.\n$/);
  });

  it("marks an embargo set on the track itself, and a private block", () => {
    const view = {
      ...sampleView,
      embargoes: [],
      tracks: sampleView.tracks.map((t) => (t.key === "H1.2" ? { ...t, embargo: { until: "2026-11-06" } } : t)),
      entries: sampleView.entries.map((e) => (e.key === "H1.1" ? { ...e, private: { by: "tarik" as const } } : e)),
    };
    const md = showNotesMarkdown(view);
    expect(md).toContain('### 2. [Artist B], "[Title B]"\n\n**PRIVATE · embargoed until Nov 6, 2026**');
    expect(md).toContain('### 1. [Artist A], "[Title A]"\n\n**PRIVATE**\n');
    expect(md).not.toContain("embargoed (date not known)");
  });

  it("leaves out angles when they are off, and shows Tarik's edit in place of the block", () => {
    const view = { ...sampleView, angles: false, entries: sampleView.entries.map((e) => (e.key === "H2.1" ? { ...e, edited: { text: "My own words." } } : e)) };
    const md = showNotesMarkdown(view);
    expect(md).not.toContain("On-air angle");
    expect(md).toContain('### 1. [Artist D], "[Title D]"\n\n**PRIVATE · embargoed (date not known)**\n\nMy own words.\n\n### 2.');
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

  it("marks a recent release of an embargoed track as private in the release dates", () => {
    const view = {
      ...sampleView,
      entries: sampleView.entries.map((e) =>
        e.key === "H1.2" ? { ...e, claims: [{ kind: "release-date" as const, text: "Out 2026-10-20.", value: "2026-10-20", status: "confirmed" as const, sources: [link] }] } : e,
      ),
    };
    expect(showNotesMarkdown(view)).toContain('[Artist B], "[Title B]" released 10 days before the show (Oct 20, 2026)[[example](https://example.org/x)] · PRIVATE');
    expect(showNotesMarkdown(view, { forAgent: true })).not.toContain("PRIVATE");
  });

  it("pre-air verify still keys Air Check's own notes by track (### headings) and keeps closing tracks closed", () => {
    const lines = numberLines(showNotesMarkdown(sampleView, { forAgent: true }), sampleView.tracks);
    const of = (text: string) => lines.find((l) => l.text.includes(text));
    expect(of("[Magazine] track of the week")).toMatchObject({ trackKey: "H1.1", closing: false });
    expect(of("closing-track, no notes")).toMatchObject({ trackKey: "H1.3", closing: true });
    expect(of("came out in September 2026 (no source found)")).not.toHaveProperty("trackKey");
  });
});

describe("notesForDraft (Review Focus 5)", () => {
  it("keeps only confirmed and sourced claims, with no embargoed, private, [verify] or angle text", () => {
    const text = notesForDraft(sampleView);
    expect(text).toBe(
      [
        '[Artist A] – "[Title A]": [Title A] is the lead single from [Album A]. It came out on [Label A]. [Title A] came out on 2026-10-16. [Artist A] is a bassist from [City]. [Artist A] wrote it after a tour of [Country]. It samples [Artist G]\'s [Title G]. The video was shot in one take in [City]. The drums were recorded in a stairwell.',
        '[Artist F] – "[Title F]": [Artist F] is a rapper from [City] who runs [Label F].',
      ].join("\n"),
    );
    expect(text).not.toMatch(/\[Artist B\]|\[Title B\]|\[Artist D\]|verify|Producer\]|supplied|late-night|https?:/);
    // Decision 021: an unsourced fact (the chart, the September date) and a one-source credit never reach a description.
    expect(text).not.toMatch(/Magazine|September 2026|co-produced/);
  });

  it("drops a private block, and keeps a thread that names no embargoed release", () => {
    const view = {
      ...sampleView,
      entries: sampleView.entries.map((e) =>
        e.key === "H1.1" ? { ...e, private: { by: "agent" as const, reason: "personal" } } : e.key === "H1.threads" ? { ...e, claims: e.claims.map((c) => ({ ...c, text: "[Artist A] and [Artist C] share a drummer." })) } : e,
      ),
    };
    expect(notesForDraft(view)).toBe('[Artist A] and [Artist C] share a drummer.\n[Artist F] – "[Title F]": [Artist F] is a rapper from [City] who runs [Label F].');
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
        // R12: the plain line and its cited sources, so a screen never parses the Markdown.
        text: "“Café” came out on October 17, 2026 on Brownswood Recordings.",
        sources: [link, { ...link, url: "https://example.org/y" }],
      },
    ]);
    expect(r.open).toEqual(["L1: It came out on 2026-10-03. — Only one source: discogs.com"]);
  });

  it("an edited line: text is Tarik's edit, with no sources", () => {
    const edited = { ...view, entries: view.entries.map((e) => (e.key === "L2" ? { ...e, edited: { text: "My own line." } } : e)) };
    expect(verifyReport(edited).changes[0]).toMatchObject({ lineId: "L2", replacement: "My own line.", text: "My own line.", sources: [] });
  });
});

describe("deepDiveMarkdown (Oct 30: an article, like our own Wikipedia page)", () => {
  const tracks = [
    { key: "H1.1", hour: 1 as const, position: 1, artist: "[Artist A]", title: "[Title A]", closing: false },
    { key: "H1.2", hour: 1 as const, position: 2, artist: "[Artist B]", title: "[Title B]", closing: true },
  ];
  const at = (n: string) => ({ url: `https://${n}.example/${n}`, host: `${n}.example`, title: `Page ${n.toUpperCase()}`, via: "tavily", primary: false, matched: true });
  const [A, B, C] = [at("a"), at("b"), at("c")];
  const claim = (kind: JudgedClaim["kind"], text: string, sources: CitedSource[], extra: Partial<JudgedClaim> = {}): JudgedClaim => ({ kind, text, status: "sourced", sources, ...extra });
  const base: DeepDiveView = {
    subject: { type: "label", name: "[Label A]" },
    tracks,
    entry: {
      key: "brief",
      claims: [
        claim("infobox", "Origin", [A], { value: "London" }),
        claim("infobox", "Founded", [B], { value: "1990" }),
        claim("lead", "[Label A] is a record label in London.", [A]),
        claim("lead", "It is known for [Genre].", [C]),
        claim("origins", "[Label A] was founded in 1990 by [Founder].", [B, A]),
        claim("origins", "The founders were DJs.", [], { status: "could-not-verify", check: "No source found." }),
        claim("career", "It signed [Artist A] in 1995.", [C]),
        claim("connection", "[Artist A] recorded for [Label A].", [C], { value: "H1.1" }),
        claim("connection", "A closing-track link.", [A], { value: "H1.2" }),
      ],
      note: "Two pages are from the same magazine.",
    },
    pastShows: { count: 3, year: 2026, last: "2026-10-16" },
  };

  it("renders an infobox, a lead with no heading, one paragraph per section, connections, past shows, checks and numbered references", () => {
    expect(deepDiveMarkdown(base)).toBe(
      [
        "# Deep dive: [Label A]",
        "",
        "| [Label A] | |",
        "|---|---|",
        "| **Origin** | London[1] |",
        "| **Founded** | 1990[2] |",
        "",
        "[Label A] is a record label in London.[1] It is known for [Genre].[3]",
        "",
        "## Origins",
        "",
        "[Label A] was founded in 1990 by [Founder].[1][2] The founders were DJs. **[verify]**",
        "",
        "## Career",
        "",
        "It signed [Artist A] in 1995.[3]",
        "",
        "## Connects to your list",
        "",
        '- **[Artist A] – "[Title A]":** [Artist A] recorded for [Label A].[3]',
        "",
        "On Rhythm Lab: 3 shows in 2026, last Oct 16, 2026",
        "",
        "## What I couldn't verify",
        "",
        "- The founders were DJs (no source found)",
        "",
        "**Note:** Two pages are from the same magazine.",
        "",
        "## References",
        "",
        "1. [Page A](https://a.example/a) · a.example",
        "2. [Page B](https://b.example/b) · b.example",
        "3. [Page C](https://c.example/c) · c.example",
        "",
      ].join("\n"),
    );
  });

  it("a brief written with the old kinds still reads as an article: each kind lands in its section, in submitted order", () => {
    const old: DeepDiveView = {
      ...base,
      pastShows: undefined,
      entry: {
        key: "brief",
        claims: [
          claim("fun-fact", "Legacy one.", [A]),
          claim("release", "Records one.", [A], { value: "X" }),
          claim("bio", "Origins one.", [A]),
          claim("samples", "Sound one.", [B]),
          claim("story", "Career one.", [A]),
          claim("detail", "Career two.", [A]),
          claim("song", "Sound two.", [B]),
          claim("label", "Records two.", [C], { value: "Y", status: "conflict" }),
          claim("chart", "Records three.", [C]),
        ],
      },
    };
    const md = deepDiveMarkdown(old);
    const headings = md.split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toEqual(["## Origins", "## Career", "## Sound and influences", "## Key records", "## Legacy", "## What I couldn't verify", "## References"]);
    expect(md).toContain("## Career\n\nCareer one.[1] Career two.[1]\n");
    expect(md).toContain("## Sound and influences\n\nSound one.[2] Sound two.[2]\n");
    expect(md).toContain("## Key records\n\nRecords one.[1] Records two. Sources disagree: c says Y.[3] **[verify]** Records three.[3]\n");
    expect(md).not.toContain("| **");
  });

  it("never asserts zero past shows (R10: a zero cannot be known), and marks an embargoed subject", () => {
    const md = deepDiveMarkdown({ ...base, pastShows: { count: 0, year: 2026 }, embargo: { until: null } });
    expect(md).not.toMatch(/No past shows|On Rhythm Lab/);
    expect(md).toContain("# Deep dive: [Label A]\n\n**PRIVATE · embargoed (date not known)**\n");
  });

  it("Tarik's edit replaces the generated article; the past-shows line stays", () => {
    const md = deepDiveMarkdown({ ...base, entry: { ...base.entry!, edited: { text: "My own brief." } } });
    expect(md).toBe("# Deep dive: [Label A]\n\nMy own brief.\n\nOn Rhythm Lab: 3 shows in 2026, last Oct 16, 2026\n");
  });
});
