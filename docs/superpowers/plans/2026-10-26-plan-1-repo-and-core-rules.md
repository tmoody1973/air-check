# Plan 1: Repo and core rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the public Air Check repo and a tested `@aircheck/core` package containing every deterministic rule the product depends on, proven by the 10-2-26 golden test.

**Architecture:** A pnpm monorepo. This plan fills only `packages/core`: pure TypeScript functions with no network and no framework. Later plans (console, agent tools, ingest, publisher) import from it. The approval gate is written against a small `PackageStore` interface, so Convex can implement it later and tests use an in-memory store.

**Tech Stack:** Node 24 LTS, pnpm, TypeScript (strict), Vitest. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-26-air-check-design.md` (approved). Detailed rules live in `skills/*/SKILL.md`, `fixtures/RLR-10-2-26-mixcloud-package.md` and `CLAUDE.md` "Hard rules". Read the skill named in each task before starting it.

**Later plans (not in this file):** Plan 2, the Nebius spikes (V1, V2, V2b, V3, V4, V7, V10, V11, V12). Plans 3 onward cover the console, agent, ingest, media and publisher, then Plan, show notes and verify, radar and digest, the player, and Bandcamp. They are written after Plan 2's results, because those results decide how the console talks to Hermes.

## Global Constraints

- New repo at `~/Projects/air-check` **(Claude's call)**. Copy everything from `~/Projects/air-check-handoff` **except** `PRIVATE_NOTES.md`, `.remember/` and `.DS_Store`. The handoff folder stays as an archive.
- License: MIT. A `LICENSE` file goes at the repo root.
- `.gitignore` must include `PRIVATE_NOTES.md`, `.env`, `.env.*`, `node_modules/` and `dist/`. Never commit a credential.
- `packages/core` has zero runtime dependencies. It uses only `node:crypto`, and only in `fingerprint.ts`.
- No per-track start times anywhere. No field or key named `start_time` (Hard Rule 11).
- Stations: only `88nine` and `hyfin`. `rhythmlab` is rejected (Hard Rule 3).
- The public description must be **under 1,000 characters**, counted in code points (`[...text].length`). That means 999 at most.
- Title pattern: `RLR M.D.YY | Artist, Artist, Artist, Artist and more`, with 4 to 6 lead artists, under 100 characters, and `|` as the default separator.
- At most 5 tags.
- Closing track: the last *parseable* track of each hour. It is included and marked `closing: true`, never flagged as missing from notes.
- No telemetry, no analytics.
- Commit messages: `<type>: <description>` (feat, fix, test, chore, docs, ci), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Pasted text from Docs, Notes or email.** Smart quotes (`“ ”`), en and em dashes, tabs, CRLF line endings and trailing spaces should parse exactly like plain ASCII. → Task 2 test `parses smart quotes, dashes and CRLF`.
2. **Hour marker variants.** `Hour 1`, `HOUR ONE`, `Hour 2:`, `hour 2 -` should all start an hour. → Task 2 test `accepts hour marker variants`.
3. **The last line of an hour can't be parsed.** The closing track moves to the last *good* line, and the bad line is still flagged. → Task 2 test `closing track skips a bad final line`.
4. **The same artist twice in one show** (Tinashe, hour 2, tracks 5 and 9). Both are kept, nothing is merged, and matching is by title. → Task 3 test `keeps repeated artist`.
5. **Approve tapped on the phone and the desk at the same moment.** Exactly one approval, and exactly one publish claim. → Task 7 test `concurrent approvals claim once`.

---

## File structure

```
air-check/
  LICENSE  README.md  .gitignore  package.json  pnpm-workspace.yaml  tsconfig.base.json
  .github/workflows/ci.yml
  docs/ (copied) + docs/SPIKES.md, docs/FRICTION_LOG.md, docs/decisions/001-005-*.md
  skills/ fixtures/ design/ reference/   (copied)
  fixtures/raw/10-2-26-drive-tracklist.txt
  fixtures/raw/10-2-26-paper-tracks.txt
  packages/core/
    package.json  tsconfig.json
    src/index.ts                re-exports everything below
    src/types.ts                shared types (Track, ParsedTracklist, PackageDraft, ...)
    src/stations.ts             assertStation
    src/tracklist/parse.ts      parseTracklist
    src/tracklist/normalize.ts  normalize, levenshtein
    src/tracklist/reconcile.ts  reconcile
    src/episode/assemble.ts     assembleEpisode
    src/package/title.ts        formatShowDate, buildTitle, checkTitleArtists, checkTags
    src/package/description.ts  checkDescription
    src/package/mixcloud.ts     toSections, toMixcloudFields
    src/package/fingerprint.ts  fingerprint
    src/package/approval.ts     ApprovalGate, canPublish
    src/boundaries.ts           findBoundaryViolations
    test/*.test.ts              one file per src module; test/helpers/memory-store.ts
  tests/boundaries.test.ts      runs findBoundaryViolations over the real repo
```

---

### Task 1: Repo scaffold, CI and decision log

**Files:**
- Create: everything under "File structure" except `packages/core/src/**` (but `src/index.ts` exports nothing yet) and the tests.
- Create: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: `pnpm test` (runs Vitest across the workspace), `pnpm typecheck` (`tsc --noEmit -p packages/core`).

- [ ] **Step 1:** Create `~/Projects/air-check` and copy the handoff contents per Global Constraints. Run `git init -b main`.
- [ ] **Step 2:** Write the root `package.json`: private, `"packageManager": "pnpm@<installed version>"`, scripts `test: vitest run`, `typecheck: tsc --noEmit -p packages/core`. Dev dependencies: `typescript`, `vitest`, `@types/node`. Also write `pnpm-workspace.yaml` (`packages/*`), `tsconfig.base.json` (strict, `module: ESNext`, `moduleResolution: Bundler`, `target: ES2023`, `noEmit: true`), and `packages/core/package.json` (`name: @aircheck/core`, `type: module`, `main: src/index.ts`).
- [ ] **Step 3:** Write `packages/core/test/smoke.test.ts` asserting `expect(1 + 1).toBe(2)`. Run `pnpm install && pnpm test`. Expected: 1 passed.
- [ ] **Step 4:** Write `.github/workflows/ci.yml`. On push to `main` and on every PR: checkout, set up pnpm and Node 24, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`.
- [ ] **Step 5:** Write `README.md` as a skeleton. It needs: a one-paragraph "what it is" from spec section 1, a "Status: in development" line, the hosting disclosure ("Models run on Nebius Token Factory (NVIDIA Nemotron); compute runs on Nebius AI Cloud; sign-in (Clerk) and the app database (Convex) are hosted services"), and the draft "what changed" note from `docs/ARCHITECTURE.md` 3.9.
- [ ] **Step 6:** Create `docs/SPIKES.md` and `docs/FRICTION_LOG.md`, each with a heading and an empty table: Spike / Date / Result / Notes for the first, Date / Tool / Friction for the second.
- [ ] **Step 7:** Write `docs/decisions/` entries in the format in `~/.claude/CLAUDE.md` "DECISION & LEARNING LOG". Each has the sections Decision, Why this came up, Options, What we chose and why (with who made the call), What we gave up, How we'll know, and **What actually happened, left blank**. Source each one from the spec section in brackets:
  - `001-approve-through-console-link.md` [5.1, Tarik]
  - `002-take-over-the-draft-not-a-browser.md` [5.3, Tarik]
  - `003-openmuse-as-pattern-reference.md` [5.2 and 7, joint]
  - `004-media-join-on-nebius-serverless.md` [5.5, Tarik]
  - `005-join-audio-before-approval.md` [5.8, Tarik chose preview; Claude chose the order change]
- [ ] **Step 8:** Run `git status` and confirm `PRIVATE_NOTES.md` is not listed. Then commit with `chore: scaffold air-check repo, CI and decision log`.
- [ ] **Step 9 (Tarik, manual):** Create the GitHub repo, push, and add branch protection on `main` requiring the CI check. Prove CI works: break the smoke test on a branch, watch the check go red, then revert.

### Task 2: Tracklist parser

Read: `design/mockups/Console.dc.html`, the tracklist parsing in `renderVals`, which is the behavior reference. Also read `skills/rlr-source-reconciliation`.

**Files:**
- Create: `packages/core/src/types.ts`, `src/tracklist/parse.ts`, `test/parse.test.ts`, `fixtures/raw/10-2-26-drive-tracklist.txt`

**Interfaces:**
- Produces:
  ```ts
  export type Hour = 1 | 2;
  export interface Track { hour: Hour; position: number; artist: string; title: string; feat?: string; raw: string; closing: boolean }
  export interface BadLine { hour: Hour | null; line: number; raw: string; reason: "before-hour-marker" | "no-separator" }
  export interface ParsedTracklist { tracks: Track[]; bad: BadLine[] }
  export function parseTracklist(text: string): ParsedTracklist
  export function formatTrack(t: Pick<Track, "artist" | "title" | "feat">): string  // Artist - "Title" feat. X
  ```

**Parsing rules:**
- Normalize line endings and trim each line. Skip blank lines.
- A line matching `/^hour\s*(1|2|one|two)\b[\s:–—-]*$/i` starts that hour.
- Otherwise, split on the **first** dash that has whitespace on both sides (`-`, `–` or `—`). The left side is the artist; the right side is the rest.
- If the rest starts with a double quote (straight `"` or curly `“`), the title runs to the next closing double quote (`"` or `”`). Single quotes and apostrophes (`'` or `’`) never delimit the title. Whatever follows the closing quote and starts with `feat.`, `ft.` or `featuring` becomes `feat`, kept verbatim, including any quotes inside it (`Tarriona "Tank" Ball`).
- If the rest is unquoted, the title is the whole rest, minus any trailing ` feat. X` clause, which goes into `feat`.
- A line before any hour marker gives `before-hour-marker`. A line with no spaced dash gives `no-separator`.
- Number good tracks 1..n per hour. Mark the last good track of each hour `closing: true`.

**Fixture:** `fixtures/raw/10-2-26-drive-tracklist.txt` is `HOUR 1`, then the 15 hour 1 lines, then `HOUR 2` and the 16 hour 2 lines, written exactly as in the golden fixture section 5 but with the Drive typos from fixture section 6 flag 2: `Ly Qua Dub`, `Joey Quinones`, `Charlotte Adigery`, `Hermanos Gutierrez`, `Los Ojos Del Cndor`. Leave out the `(closing track)` notes. Add a first line `# Synthesized from the golden fixture; replace with the real Drive export when available.`, and have the parser skip lines starting with `#`.

- [ ] **Step 1: Write the failing tests** in `test/parse.test.ts`:
  ```ts
  test("golden 10-2-26 parses to 15 + 16 with closing tracks", () => {
    const p = parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt"));
    expect(p.bad).toEqual([]);
    expect(p.tracks.filter(t => t.hour === 1)).toHaveLength(15);
    expect(p.tracks.filter(t => t.hour === 2)).toHaveLength(16);
    expect(p.tracks.filter(t => t.closing).map(formatTrack)).toEqual([
      'Channell & 2bfrank - "Just Move"',
      'SW2 vs EL-B - "Nightmare On Bascombe Street"',
    ]);
  });
  test("splits on spaced dash only", () => {
    const [t] = parseTracklist('HOUR 2\nSW2 vs EL-B - "Nightmare On Bascombe Street"').tracks;
    expect(t.artist).toBe("SW2 vs EL-B");
  });
  test("keeps feat. outside quotes", () => {
    const [t] = parseTracklist('HOUR 1\nResavoir - "4th Cloud" feat. Gregory Uhlmann').tracks;
    expect(t).toMatchObject({ title: "4th Cloud", feat: "Gregory Uhlmann" });
  });
  test("feat. with quotes inside it", () => {
    const [t] = parseTracklist('HOUR 1\nYour Old Droog - "I Appreciate You" feat. Tarriona "Tank" Ball').tracks;
    expect(t).toMatchObject({ title: "I Appreciate You", feat: 'Tarriona "Tank" Ball' });
  });
  test("keeps comma in artist", () => {
    const [t] = parseTracklist(`HOUR 1\nWalter Bishop, Jr. - "N'Dugu's Prayer"`).tracks;
    expect(t.artist).toBe("Walter Bishop, Jr.");
  });
  test("flags unparseable and pre-hour lines", () => {
    const p = parseTracklist("Intro line\nHOUR 2\nTinashe Sunglasses\nActress - Withending");
    expect(p.bad.map(b => b.reason)).toEqual(["before-hour-marker", "no-separator"]);
    expect(p.tracks[0]).toMatchObject({ title: "Withending", closing: true });
  });
  test("closing track skips a bad final line", () => {
    const p = parseTracklist('HOUR 1\nA - "One"\nB - "Two"\nbroken line');
    expect(p.tracks.find(t => t.closing)?.title).toBe("Two");
    expect(p.bad).toHaveLength(1);
  });
  test("parses smart quotes, dashes and CRLF", () => {
    const p = parseTracklist("Hour 1\r\nMichael Kiwanuka – “Summer Clothes”  \r\n\tBicep — “Viper” feat. Clark & Saskia\r\n");
    expect(p.tracks.map(t => [t.artist, t.title, t.feat])).toEqual([
      ["Michael Kiwanuka", "Summer Clothes", undefined],
      ["Bicep", "Viper", "Clark & Saskia"],
    ]);
  });
  test("accepts hour marker variants", () => {
    for (const m of ["Hour 1", "HOUR ONE", "hour 1 -", "Hour 1:"])
      expect(parseTracklist(`${m}\nA - "B"`).tracks[0].hour).toBe(1);
    expect(parseTracklist('Hour 2:\nA - "B"').tracks[0].hour).toBe(2);
  });
  ```
  `readFixture(rel)` is a tiny helper in `test/helpers/fixtures.ts` that reads `<repo>/fixtures/<rel>` as UTF-8.
- [ ] **Step 2:** Run `pnpm test parse`. Expected: FAIL, `parseTracklist` is not defined.
- [ ] **Step 3:** Implement `parseTracklist` and `formatTrack` in `src/tracklist/parse.ts`, and the types in `src/types.ts`, per the rules above. Export them from `src/index.ts`.
- [ ] **Step 4:** Run `pnpm test parse`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): tracklist parser with closing-track marking`.

### Task 3: Normalize and reconcile against Paper notes

Read: `skills/rlr-source-reconciliation` in full.

**Files:**
- Create: `src/tracklist/normalize.ts`, `src/tracklist/reconcile.ts`, `test/reconcile.test.ts`, `fixtures/raw/10-2-26-paper-tracks.txt`

**Interfaces:**
- Consumes: `ParsedTracklist`, `Track`, `parseTracklist` (Task 2).
- Produces:
  ```ts
  export function normalize(s: string): string   // lowercase, strip accents (NFD + remove \p{M}), drop feat./ft./featuring clause, remove punctuation, collapse spaces
  export function levenshtein(a: string, b: string): number
  export interface PaperTrack { hour: Hour; artist: string; title: string }
  export type TrackStatus = "confirmed" | "spelling-fixed" | "unverified-in-notes" | "closing-track";
  export interface ReconciledTrack extends Track { status: TrackStatus }
  export interface Reconciled { tracks: ReconciledTrack[]; questions: string[] }
  export function reconcile(drive: ParsedTracklist, paper: PaperTrack[]): Reconciled
  ```

**Rules:**
- Order and count come from Drive, always. The output always has exactly as many tracks as Drive.
- Within each hour, match each Drive track to a not-yet-used Paper track whose `normalize(title)` is equal. Failing that, the artist must be equal under `normalize` and the titles must be within `levenshtein(...) ≤ 2`.
- When matched: if the artist and title strings are identical, the status is `confirmed`. Otherwise take the Paper strings (Paper wins on spelling) and set `spelling-fixed`.
- An unmatched Drive track with `closing: true` gets `closing-track`, and no question is asked.
- Any other unmatched Drive track gets `unverified-in-notes`, plus the question `Hour N track P "Artist - Title" is in the tracklist but not in the notes. Keep it?`.
- An unmatched Paper track is **never added** to the tracklist. It gets the question `"Artist - Title" is in the notes (hour N) but not in the tracklist.`.
- A closing track that *does* match a Paper entry stays `closing: true`, with status `confirmed` or `spelling-fixed`.

**Fixture:** `fixtures/raw/10-2-26-paper-tracks.txt` holds one `H<hour> | Artist | Title` line per track. It has the golden spellings with accents and **no** closing tracks: 14 + 15 lines.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  test("golden: 31 tracks, both closing, Paper spellings, no questions", () => {
    const r = reconcile(parseTracklist(readFixture("raw/10-2-26-drive-tracklist.txt")), readPaper("raw/10-2-26-paper-tracks.txt"));
    expect(r.tracks).toHaveLength(31);
    expect(r.tracks.filter(t => t.status === "closing-track")).toHaveLength(2);
    expect(r.questions).toEqual([]);
    const titles = r.tracks.map(formatTrack);
    for (const s of ['Saigon Soul Revival - "Lý Qua Dub"', 'Hermanos Gutiérrez - "Los Ojos Del Cóndor"',
                     'Charlotte Adigéry & Bolis Pupul - "Googoo Gaga"', `Thee Sinseers & Joey Quiñones - "Let's Fall In Love (Again)"`])
      expect(titles).toContain(s);
  });
  test("golden output equals fixture section 5 line for line", () => {
    // expected list: the 31 lines of fixtures/RLR-10-2-26-mixcloud-package.md section 5, "(closing track)" stripped
    expect(reconcile(drive, paper).tracks.map(formatTrack)).toEqual(goldenLines());
  });
  test("keeps repeated artist", () => {
    const r = reconcile(parseTracklist('HOUR 2\nTinashe - "Twentyfive Eight"\nTinashe - "Sunglasses"\nX - "Close"'),
      [{ hour: 2, artist: "Tinashe", title: "Twentyfive Eight" }, { hour: 2, artist: "Tinashe", title: "Sunglasses" }]);
    expect(r.tracks.map(t => t.title)).toEqual(["Twentyfive Eight", "Sunglasses", "Close"]);
  });
  test("extra non-closing track is kept and asked about", () => {
    const r = reconcile(parseTracklist('HOUR 1\nA - "One"\nB - "Two"\nC - "Three"'), [{ hour: 1, artist: "B", title: "Two" }]);
    expect(r.tracks.map(t => t.status)).toEqual(["unverified-in-notes", "confirmed", "closing-track"]);
    expect(r.questions).toHaveLength(1);
  });
  test("paper-only track is never added", () => {
    const r = reconcile(parseTracklist('HOUR 1\nA - "One"'), [{ hour: 1, artist: "Z", title: "Ghost" }]);
    expect(r.tracks).toHaveLength(1);
    expect(r.questions[0]).toContain("Ghost");
  });
  ```
  `readPaper` and `goldenLines` live in `test/helpers/fixtures.ts`. `goldenLines` parses the fixture's section 5 numbered lines.
- [ ] **Step 2:** Run `pnpm test reconcile`. Expected: FAIL.
- [ ] **Step 3:** Implement `normalize`, `levenshtein` and `reconcile` per the rules above.
- [ ] **Step 4:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): reconcile Drive tracklist against Paper notes`.

### Task 4: Box episode assembly

Read: `skills/rlr-box-episode-assembly` in full. It defines the patterns, the ignores and the size checks.

**Files:** Create `src/episode/assemble.ts` and `test/assemble.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface BoxFile { id: string; name: string; size: number }
  export interface EpisodeAssembly {
    status: "ready" | "incomplete" | "ask";
    date: string | null;            // ISO YYYY-MM-DD, from the folder name
    hour1?: BoxFile; hour2?: BoxFile;
    pattern?: "9125-9126" | "29934-29935" | "rlr-full-hour" | "legacy";
    ignored: string[];              // file names
    flags: string[];
  }
  export function assembleEpisode(folderName: string, files: BoxFile[]): EpisodeAssembly
  ```

**Rules:**
- Folder `M-D-YY` (zero-padded parts allowed) becomes `20YY-MM-DD`. If the name isn't parseable, or contains `RECAP` or `Best of` (case-insensitive), the status is `ask`.
- Try the patterns in the skill's order. The first full pair wins.
- If both hours carry an `MMDDYY` suffix that disagrees with the folder date, the status is `ask`, with the flag `date mismatch`.
- Ignore `9101`-`9105`, `9201`-`9205`, `9120`, names starting with `RLR Tonight at`, `.DS_Store`, and anything not ending in `.wav`.
- Only one hour found gives `incomplete`.
- Each hour's size must be between `570_000_000` and `660_000_000` bytes. Otherwise add the flag `hour N size out of range`, but the status can still be `ready`. If the two sizes differ by more than 10% of the larger one, add the flag `hour sizes differ by more than 10%`.

- [ ] **Step 1: Write the failing tests.** These cover the golden folder `10-2-26` with the fixture's ids and sizes plus every ignored file (expect `ready`, pattern `9125-9126`, 13 ignored, no flags); `5-22-26` with `29934_Rhythm Lab Radio hour 1_Tarik Moody_052226.wav` and `29935_...hour 2...` (expect pattern `29934-29935`); `3-20-26` with `RLR - Full Hour 1 - 032026.wav` and `RLR- Full Hour 2 - 032026.wav` (expect `rlr-full-hour`); `1-09-26` (expect date `2026-01-09`); only `9125.wav` (expect `incomplete`); folder `RECAP 2026` (expect `ask`); a 29934 pair with suffix `052326` in folder `5-22-26` (expect `ask`); and hour 2 at 400 MB (expect flags for range and difference).
- [ ] **Step 2:** Run `pnpm test assemble`. Expected: FAIL.
- [ ] **Step 3:** Implement `assembleEpisode`.
- [ ] **Step 4:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): Box episode assembly rules`.

### Task 5: Title, tags and stations

Read: `skills/rlr-mixcloud-title-and-tags`.

**Files:** Create `src/package/title.ts`, `src/stations.ts`, `test/title.test.ts` and `test/stations.test.ts`.

**Interfaces:**
- Consumes: `Track`, `normalize` (Tasks 2 and 3).
- Produces:
  ```ts
  export function formatShowDate(iso: string): string                        // "2026-10-02" -> "10.2.26"
  export function buildTitle(iso: string, leads: string[], sep?: "|" | ":"): string  // throws RangeError if leads.length <4 or >6, or result >= 100 chars
  export function checkTitleArtists(leads: string[], tracks: Track[]): string[]      // leads with no match in any track artist (normalize(lead) contained in normalize(artist))
  export function checkTags(tags: string[]): string[]                        // problems: "more than 5 tags", "empty tag", "duplicate tag: X" (case-insensitive)
  export type Station = "88nine" | "hyfin";
  export function assertStation(s: string): Station                          // throws Error(`station not allowed: ${s}`) otherwise
  ```

- [ ] **Step 1: Write the failing tests:**
  ```ts
  expect(buildTitle("2026-10-02", ["Michael Kiwanuka","Tinashe","Bicep","Kaytranada","Hiatus Kaiyote"]))
    .toBe("RLR 10.2.26 | Michael Kiwanuka, Tinashe, Bicep, Kaytranada, Hiatus Kaiyote and more");
  expect(buildTitle("2026-10-02", ["A","B","C","D"], ":")).toBe("RLR 10.2.26: A, B, C, D and more");
  expect(() => buildTitle("2026-10-02", ["A","B","C"])).toThrow(RangeError);
  // all three titles in the golden fixture section 2 pass checkTitleArtists against the golden tracks
  // (covers "Seun Kuti" vs "Seun Kuti & Egypt 80" and "Walter Bishop Jr." vs "Walter Bishop, Jr.")
  expect(checkTitleArtists(["Michael Kiwanuka","Radiohead"], goldenTracks)).toEqual(["Radiohead"]);
  expect(checkTags(["Jazz","Electronic","R&B","Soul","Hip Hop"])).toEqual([]);
  expect(checkTags(["Jazz","jazz","Soul","R&B","Indie","Electronic"])).toEqual(["more than 5 tags","duplicate tag: jazz"]);
  expect(assertStation("hyfin")).toBe("hyfin");
  for (const s of ["rhythmlab", "RHYTHMLAB", "88Nine ", ""]) expect(() => assertStation(s)).toThrow();
  ```
  `goldenTracks` is the output of `reconcile` on the golden inputs (helper).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the functions above. `assertStation` does an exact, case-sensitive match. Rejecting `88Nine ` is deliberate: callers must pass the canonical id.
- [ ] **Step 4:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): title, tag and station rules`.

### Task 6: Description check and Mixcloud fields

Read: `skills/rlr-description-safety` and `docs/ARCHITECTURE.md` 3.5 (upload fields).

**Files:** Create `src/package/description.ts`, `src/package/mixcloud.ts`, `test/description.test.ts` and `test/mixcloud.test.ts`.

**Interfaces:**
- Consumes: `Track`, `formatShowDate` (Tasks 2 and 5).
- Produces:
  ```ts
  export type DescriptionIssue =
    | { kind: "too-long"; length: number }
    | { kind: "first-line" }
    | { kind: "time-relative"; phrase: string }
    | { kind: "tracklist"; titles: string[] }
    | { kind: "private"; term: string };
  export function checkDescription(text: string, opts: { showDate: string; trackTitles: string[]; privateTerms: string[] }): DescriptionIssue[]
  export interface Section { artist: string; song: string }
  export function toSections(tracks: Track[]): Section[]            // song = title + (feat ? ` feat. ${feat}` : "")
  export interface PackageDraft {
    id: string; workspace: "real" | "demo"; showDate: string;
    title: string; tags: string[]; description: string; tracks: Track[];
    audio: { hour1Id: string; hour2Id: string; mp3Sha256?: string }; picture?: string;
  }
  export function toMixcloudFields(p: PackageDraft): Record<string, string>   // name, description, tags-N-tag, sections-N-artist, sections-N-song
  ```

**Rules:**
- `too-long`: `[...text].length > 999`.
- `first-line`: the text must start with `Rhythm Lab Radio, week of <Month D, YYYY>, hosted by Tarik Moody and produced by Radio Milwaukee.`, with the month name in English (for example "October 2, 2026").
- `time-relative`: case-insensitive matches of these patterns: `out (today|now|this week|next week|tomorrow)`, `(this|next) (friday|week|weekend|month)`, `\b(today|tomorrow|tonight|yesterday)\b`, `(coming|out|arrives|drops|due)( on)? <MonthName> \d{1,2}`, `\bupcoming\b`, `\bjust (dropped|released|announced)\b`. Report each matched phrase.
- `tracklist`: three or more distinct `trackTitles` (5 or more characters each, case-insensitive) appearing in the text **(Claude's call on the threshold)**.
- `private`: any `privateTerms` entry appears, case-insensitive.
- `toMixcloudFields` must never emit `start_time` or `unlisted`. Unlisted uploads are a spike-only concern for the publisher (Plan 5). Tags are emitted in order as `tags-0-tag` to `tags-4-tag`. It throws if `checkTags` reports problems.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  const golden = goldenDescription(); // fixture section 4, the three paragraphs, notes in parentheses excluded
  const opts = { showDate: "2026-10-02", trackTitles: goldenTitles, privateTerms: ["health"] };
  expect(checkDescription(golden, opts)).toEqual([]);
  expect([...golden].length).toBeLessThan(1000);
  const bad = golden.replace("new soul", "new soul, out TODAY, and the record coming October 23");
  const phrases = checkDescription(bad, opts).flatMap(i => (i.kind === "time-relative" ? [i.phrase.toLowerCase()] : []));
  expect(phrases).toEqual(expect.arrayContaining(["out today", "coming october 23"]));
  expect(checkDescription("x".repeat(1000), opts)).toContainEqual({ kind: "too-long", length: 1000 });
  expect(checkDescription("é".repeat(999), opts).some(i => i.kind === "too-long")).toBe(false); // counts code points, not bytes
  expect(checkDescription(golden + " Summer Clothes, Withending, Googoo Gaga", opts).some(i => i.kind === "tracklist")).toBe(true);
  expect(checkDescription(golden + " a health matter", opts).some(i => i.kind === "private")).toBe(true);

  const f = toMixcloudFields(goldenDraft());
  expect(Object.keys(f).filter(k => k.startsWith("sections-") && k.endsWith("-artist"))).toHaveLength(31);
  expect(f["sections-3-song"]).toBe("4th Cloud feat. Gregory Uhlmann");
  expect(Object.keys(f).some(k => /start_time|unlisted/.test(k))).toBe(false);
  expect([f["tags-0-tag"], f["tags-4-tag"]]).toEqual(["Jazz", "Hip Hop"]);
  ```
  `goldenDescription()`, `goldenTitles` (the 31 titles) and `goldenDraft()` (a `PackageDraft` built from the golden title, tags, description and reconciled tracks) live in `test/helpers/fixtures.ts`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `checkDescription`, `toSections` and `toMixcloudFields`.
- [ ] **Step 4:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): description safety check and Mixcloud field mapping`.

### Task 7: Fingerprint and approval gate

Read: spec sections 7.1 and 5.8, and openmuse `apps/server/src/actions.ts` (clone it to a scratch dir if needed; it is MIT). Copy no code. The structure there is the reference.

**Files:** Create `src/package/fingerprint.ts`, `src/package/approval.ts`, `test/helpers/memory-store.ts` and `test/approval.test.ts`.

**Interfaces:**
- Consumes: `PackageDraft`, `toSections` (Task 6).
- Produces:
  ```ts
  export function fingerprint(p: PackageDraft): string   // sha256 hex of canonical JSON {title, tags, description, sections, hour1Id, hour2Id, mp3Sha256, picture}; throws if mp3Sha256 missing
  export type PackageStatus = "preparing_audio" | "awaiting_review" | "approved" | "skipped" | "publishing" | "succeeded" | "failed" | "outcome_unknown";
  export interface PackageRecord { draft: PackageDraft; status: PackageStatus; fingerprint?: string; decidedBy?: string; decidedAt?: string; result?: { url?: string; error?: string } }
  export interface PackageStore {
    get(id: string): Promise<PackageRecord | null>;
    put(rec: PackageRecord): Promise<void>;
    compareAndSwap(id: string, expected: { status: PackageStatus; fingerprint?: string }, next: Partial<PackageRecord>): Promise<PackageRecord | null>;
  }
  export type Actor = { kind: "human"; userId: string; email: string } | { kind: "agent" };
  export interface Transition { id: string; from: PackageStatus | null; to: PackageStatus; by: string; at: string }
  export class GateError extends Error { code: "FORBIDDEN" | "NOT_FOUND" | "PACKAGE_CHANGED" | "NOT_READY" | "DEMO_CANNOT_PUBLISH" }
  export class ApprovalGate {
    constructor(store: PackageStore, opts?: { now?: () => Date; onTransition?: (t: Transition) => Promise<void> });
    submit(draft: PackageDraft): Promise<PackageRecord>;                 // preparing_audio, or awaiting_review + fingerprint if mp3Sha256 already set
    attachAudio(id: string, mp3Sha256: string): Promise<PackageRecord>;  // -> awaiting_review, fingerprint set
    revise(id: string, draft: PackageDraft): Promise<PackageRecord>;    // only from awaiting_review; new fingerprint
    decide(id: string, fp: string, decision: "approve" | "skip", actor: Actor): Promise<PackageRecord>;
    claimForPublish(id: string): Promise<PackageRecord | null>;         // approved -> publishing; null otherwise; throws DEMO_CANNOT_PUBLISH for demo
    recordResult(id: string, r: { status: "succeeded"; url: string } | { status: "failed"; error: string } | { status: "outcome_unknown" }): Promise<PackageRecord>; // only from publishing
  }
  export function canPublish(rec: PackageRecord): boolean               // status === "approved" && draft.workspace === "real"
  ```

**Rules:** `decide` runs its checks in this order:
1. `FORBIDDEN` unless `actor.kind === "human"` and `email` ends with `@radiomilwaukee.org`. This is Hard Rule 1 at the gate.
2. `NOT_FOUND` if there is no record.
3. If the status is `approved`, `skipped` or later, return the record unchanged (idempotent).
4. `NOT_READY` if the status is `preparing_audio`.
5. `PACKAGE_CHANGED` if `fp` doesn't equal the stored fingerprint.
6. Move the status with `compareAndSwap` keyed on `{status: "awaiting_review", fingerprint: fp}`. If the swap returns null, re-read and return the current record.
- There is **no time expiry** (spec 5.4).
- `claimForPublish` from `outcome_unknown`, `failed` or `succeeded` returns null. Nothing retries automatically.
- Every successful transition calls `onTransition` with `by` set to the user's email, `"agent"`, or `"publisher"`.

- [ ] **Step 1: Write the failing tests** in `test/approval.test.ts`, using an in-memory `PackageStore` whose `compareAndSwap` is atomic within the event loop:
  ```ts
  test("cannot approve before audio exists", ...)            // submit without mp3 -> decide throws NOT_READY
  test("agent cannot approve", ...)                          // actor {kind:"agent"} -> FORBIDDEN
  test("outside domain cannot approve", ...)                 // email x@gmail.com -> FORBIDDEN
  test("changed package cannot be approved with old fingerprint", ...) // revise then decide(old fp) -> PACKAGE_CHANGED
  test("concurrent approvals claim once", async () => {
    const [a, b] = await Promise.all([gate.decide(id, fp, "approve", tarik), gate.decide(id, fp, "approve", tarik)]);
    expect([a.status, b.status]).toEqual(["approved", "approved"]);
    expect(transitions.filter(t => t.to === "approved")).toHaveLength(1);
    const [c1, c2] = await Promise.all([gate.claimForPublish(id), gate.claimForPublish(id)]);
    expect([c1, c2].filter(Boolean)).toHaveLength(1);
  });
  test("skip is final", ...)                                 // skip then approve -> returns skipped, canPublish false
  test("demo package never publishes", ...)                  // workspace demo, approved -> canPublish false; claimForPublish throws DEMO_CANNOT_PUBLISH
  test("outcome_unknown is never re-claimed", ...)           // recordResult outcome_unknown -> claimForPublish null
  test("fingerprint covers the mp3", ...)                    // same draft, different mp3Sha256 -> different fingerprint
  test("fingerprint is stable across key order", ...)        // same content, objects built in different key order -> same fingerprint
  ```
  Write each `...` as a full test with the assertion named in its comment.
- [ ] **Step 2:** Run `pnpm test approval`. Expected: FAIL.
- [ ] **Step 3:** Implement `fingerprint`, `ApprovalGate` and `canPublish`. Canonical JSON means keys sorted recursively and `JSON.stringify`.
- [ ] **Step 4:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): package fingerprint and approval gate`.

### Task 8: Boundary checks for Hard Rules 1 and 2

**Files:** Create `src/boundaries.ts`, `test/boundaries.unit.test.ts` and `tests/boundaries.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface SourceFile { path: string; content: string }   // path relative to repo root, forward slashes
  export function findBoundaryViolations(files: SourceFile[]): string[]
  ```

**Rules** (each violation is a one-line string naming the file and the rule):
Exempt from all three rules: `docs/`, `skills/`, `fixtures/`, `*.md`, `packages/core/test/`, `packages/core/src/boundaries.ts` and `tests/boundaries.test.ts`. These files name the forbidden strings in order to check for them.
1. Only files under `services/publisher/` may contain `api.mixcloud.com/upload`. The field-name builder `packages/core/src/package/mixcloud.ts` is allowed because it holds no URL.
2. No file under `agent/` may import from `services/` or reference `MIXCLOUD_`, `BOX_`, `GOOGLE_`, `DROPBOX_` or `SUBSONIC_` environment variable names.
3. No other file may contain `start_time`.

- [ ] **Step 1: Write the failing unit tests.** Use synthetic `SourceFile` lists: `agent/tools/x.ts` importing `../../services/publisher/upload` gives 1 violation; `apps/console/x.ts` containing `https://api.mixcloud.com/upload/` gives 1; `services/publisher/upload.ts` containing it gives 0; `agent/env.ts` containing `process.env.MIXCLOUD_TOKEN` gives 1; `services/media/x.ts` containing `start_time` gives 1.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `findBoundaryViolations`.
- [ ] **Step 4:** Write `tests/boundaries.test.ts`, which walks the repo (skipping `node_modules`, `.git` and `dist`), reads `.ts`, `.tsx`, `.js`, `.mjs`, `.json`, `.yml` and `.env.example` files, and asserts `findBoundaryViolations(files)` equals `[]`. Add `tests/**` to the Vitest include.
- [ ] **Step 5:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 6:** Commit with `test: boundary checks for approval path, agent credentials and start times`.

### Task 9: Close out

- [ ] **Step 1:** Run `pnpm typecheck && pnpm test`. Expected: no type errors and every test passing. Paste the summary line into the PR or hand-back.
- [ ] **Step 2:** In `docs/SPIKES.md`, add a "Core rules (Plan 1)" note: what the golden test proves, and that the Drive and Paper fixtures are synthesized until real exports replace them (spec 5.6).
- [ ] **Step 3:** Fix the doc items in spec section 9 that live in files copied into this repo: the ARCHITECTURE 3.4, 3.5, 3.6 and 3.12 wording, `CLAUDE.md` rule numbering, and PRODUCT.md "five" changed to "eight". Mark ARCHITECTURE sections 1, 7 and 8 as superseded.
- [ ] **Step 4:** Commit with `docs: align handoff docs with approved design`.
