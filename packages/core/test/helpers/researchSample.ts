// Synthetic show-notes view behind fixtures/show-notes-sample.md (Sample Honesty: placeholders and example.org only).
import type { CitedSource, JudgedClaim, ShowNotesView } from "../../src/index";

const src = (path: string, extra: Partial<CitedSource> = {}): CitedSource => ({
  url: `https://example.org/${path}`,
  host: "example.org",
  title: `[Page ${path}]`,
  via: "tavily",
  primary: false,
  matched: true,
  ...extra,
});

const claim = (c: Omit<JudgedClaim, "sources"> & { sources: CitedSource[] }): JudgedClaim => c;

export const sampleView: ShowNotesView = {
  showDate: "2026-10-30",
  angles: true,
  tracks: [
    { key: "H1.1", hour: 1, position: 1, artist: "[Artist A]", title: "[Title A]", closing: false },
    { key: "H1.2", hour: 1, position: 2, artist: "[Artist B]", title: "[Title B]", closing: false },
    { key: "H1.3", hour: 1, position: 3, artist: "[Artist C]", title: "[Title C]", closing: true },
    { key: "H2.1", hour: 2, position: 1, artist: "[Artist D]", title: "[Title D]", closing: false },
    { key: "H2.2", hour: 2, position: 2, artist: "[Artist E]", title: "[Title E]", closing: true },
  ],
  embargoes: [
    { artist: "[Artist B]", title: "[Title B]", until: "2026-11-06" },
    { artist: "[Artist D]", title: "[Title D]", until: null },
  ],
  entries: [
    { key: "H1.intro", claims: [], intro: "The hour moves from [Artist A]'s new single into older label cuts." },
    {
      key: "H1.threads",
      claims: [claim({ kind: "thread", text: "[Artist A] and [Artist B] both recorded at [Studio], and [Artist B] wrote [Title B] there.", status: "sourced", sources: [src("studio")] })],
    },
    {
      key: "H1.1",
      claims: [
        claim({ kind: "release", text: "[Title A] is the lead single from [Album A].", value: "[Album A]", status: "sourced", sources: [src("a1", { primary: true })] }),
        claim({ kind: "label", text: "[Title A] is on [Label A].", value: "[Label A]", status: "confirmed", sources: [src("a1", { primary: true }), src("a2")] }),
        claim({ kind: "release-date", text: "[Title A] came out on 2026-10-16.", value: "2026-10-16", status: "confirmed", sources: [src("a1", { primary: true }), src("a2")] }),
        claim({ kind: "detail", text: "[Artist A] co-produced the track with [Producer].", status: "sourced", sources: [src("a2")] }),
        claim({ kind: "bio", text: "[Artist A] is a bassist from [City].", status: "sourced", sources: [src("a3")] }),
      ],
      angle: "What does [Producer] bring to the low end here?",
      suppliedNote: "[Label A]'s one-sheet calls it a late-night record.",
    },
    {
      key: "H1.2",
      claims: [
        claim({
          kind: "release-date",
          text: "[Title B] came out on 2026-10-10.",
          value: "2026-10-10",
          status: "conflict",
          sources: [src("b1", { says: "2026-10-10" }), src("b2", { says: "2026-10-17" })],
          check: "Sources disagree: 2026-10-10 (example.org) vs 2026-10-17 (example.org)",
        }),
      ],
    },
    { key: "H2.intro", claims: [], intro: "The second hour slows down around [Artist D]." },
    {
      key: "H2.1",
      claims: [
        claim({ kind: "detail", text: "[Artist D] recorded it live in one take.", status: "sourced", sources: [src("d2")] }),
        claim({ kind: "label", text: "It came out on [Label D].", value: "[Label D]", status: "could-not-verify", sources: [src("d1")], check: "Only one source: example.org" }),
        claim({ kind: "bio", text: "[Artist D] leads a quartet from [City].", status: "sourced", sources: [src("d2")] }),
      ],
      angle: "Which earlier [Label D] record sets this one up?",
    },
  ],
};
