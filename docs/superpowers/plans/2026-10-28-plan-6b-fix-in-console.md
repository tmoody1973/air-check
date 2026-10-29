# Plan 6b: fix backlog problems in the console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarik fixes every Episodes question in the console: edit a tracklist, choose between duplicate docs or folders, pick the two hour files, confirm a show's date. The fix is saved in Air Check, and the show moves on within a couple of minutes.

**Architecture:**
- **Corrections table.** A new Convex table, `corrections`, holds one row per show, written only by a signed-in real human.
- **Scanner.** The ingest scanner reads the corrections with its token and applies them inside `buildEpisodes` before the rules run.
- **Rescan.** Saving a correction sets a timestamp the scanner checks every minute, which starts one rescan.
- **Choices.** Questions gain a structured `fix` (what can be chosen, with ids), so the page offers real choices and Convex only accepts ids it offered.
- **Undated names.** Docs and folders whose names the scanner cannot date (for example `Rhythm Lab Radio 9-4-226`) stop being skipped silently. They are listed on Episodes, and Tarik places each one on a show date. The placement is saved in Air Check and is never written back as a rename.
- **Read-only sources.** Drive, Paper and Box are never written.

**Tech Stack:** TypeScript, Convex, Next.js (App Router) + Tailwind, the `apps/ingest` service, `@aircheck/core`, Vitest.

**Spec:**
- **The decision:** `docs/decisions/017-fix-backlog-problems-in-air-check.md` (Tarik's call, Oct 28, option A).
- **What it builds on:** Plan 6 (`docs/superpowers/plans/2026-10-28-plan-6-ingest-and-episodes.md`) and its ledger rulings R1–R18, plus PR #16 "Drive decides".
- **Project rules:** `CLAUDE.md` Hard Rules 1, 2, 5, 8, 9 and 12.

## Global Constraints

- **Never write to the sources.** Air Check never writes to Drive, Paper or Box. Every source scope stays read-only; no new provider call is added anywhere.
- **Only a person writes corrections.** Every correction mutation calls `requireRealHuman`, so the demo workspace and signed-out callers get FORBIDDEN (Hard Rule 9). The agent gets no tool and no route for corrections (Hard Rule 1 spirit). `convex/hardRule1.test.ts`'s allowlist names each new mutation.
- **Offered choices only.** A picked doc, folder or file id must be one the show's current question offered (`fix.choices`). Anything else is BAD_INPUT, so a correction can never point the scanner at a file it did not list itself.
- **Drafted shows are frozen.** Corrections are refused for a show that has a package in any status, or an open draft run ("this show already has a package; change it on the package page").
- **The typed tracklist is final.** A corrected tracklist is used exactly as typed. Paper never changes its spelling, closing tracks are auto-marked as everywhere else, and no per-track times exist (Hard Rule 11; the literal `start_time` never appears).
- **Tracklist limits.** A corrected tracklist is at most 20,000 characters (`MAX_NOTES` in `convex/tracklist.ts`, reused) and at most 100 tracks (`MAX_TRACKS`). Both hours need tracks, and no line may be unreadable, using the same rule the scanner applies to Drive (`parseDriveTracklist`, Task 1).
- **Logs.** Hard Rule 8: logs carry dates, steps, counts and timings. Never tracklist text, file names or ids.
- **The Drive text stays private.** The stored Drive tracklist text (`tracklist.text`) is never returned by `episodes.list`. It is read one show at a time, by a signed-in real human, through `corrections.tracklistText`.

## Review Focus

1. **A fix that stops matching.** Tarik picked "Rhythm Lab Radio 2-6-26 (copy)", then deleted that doc in Drive. The correction is ignored, the original question comes back, and the row says "Your fix no longer matches Drive. Use Drive again or fix it again." Test owned by Task 1 (build) and Task 4 (label).
2. **Saving many fixes quickly.** Five saves in a minute cause one rescan after the last save, never two scans at once. Test owned by Task 3.
3. **A show that already failed.** A `draft-failed` show gets two fresh draft attempts after any fix; earlier failed runs no longer count. Test owned by Task 2.
4. **A typed tracklist with problems.** One hour only, an unreadable line, or 101 tracks is refused before saving, with the same plain issues the page shows live. Test owned by Task 2 (Convex) and Task 4 (live preview).
5. **A forged choice.** An id that the show's question did not offer, or the same file chosen as both hours, is refused. Test owned by Task 2.

---

### Task 1: Corrections in the scanner's rules (core + `apps/ingest/src/build.ts`, pure)

**Files:**
- Create: `packages/core/src/tracklist/drive.ts` (moved from build.ts)
- Modify: `packages/core/src/index.ts`, `apps/ingest/src/build.ts`, `apps/ingest/src/convex.ts` (types only), `apps/ingest/src/scan.ts` (readBox passes the WAV list)
- Test: `packages/core/test/parse.test.ts`, `apps/ingest/test/build.test.ts`, `apps/ingest/test/scan.test.ts` (undated names)

**Interfaces:**
- Produces, in core:
  - `parseDriveTracklist(text: string): ParsedTracklist`: the body of today's `parseDrive` in build.ts, moved unchanged. Lines above HOUR 1 that hold no spaced dash are not "bad".
- Produces, in ingest `convex.ts`:
  - `type Fix = { type: "tracklist" } | { type: "pick"; source: "box" | "drive" | "paper"; choices: { id: string; name: string }[] } | { type: "hours"; choices: { id: string; name: string }[] } | { type: "stamp"; folderDate: string; stampDate: string }`
  - `Question` gains `fix?: Fix`, and `ScannedEpisode.tracklist` gains `text?: string`.
  - `interface Correction { showDate: string; tracklistText?: string; drive?: string; paper?: string; box?: string; hours?: { hour1: string; hour2: string }; folderDate?: true; updatedAt: number }`
- Produces, in build.ts:
  - `BoxFolder` gains `wavs: BoxFile[]`, every `.wav` in the folder, filled by `readBox`.
  - `buildEpisodes(found, stored, onDisk, corrections: Correction[] = [])`.
  - Each built episode carries `corrected?: { stale: boolean }`. This is internal and is not sent to Convex.
- Produces, in scan.ts:
  - `dated(name, id, placements)` first checks a placement by id. It then reports the names that `showDateFromTitle` refuses with any reason other than "No date found in the title.".
  - The new type: `interface Unplaced { source: "box" | "drive" | "paper"; id: string; name: string; reason: string }`, with at most 50 per scan.
  - `interface Placement { source: "box" | "drive" | "paper"; id: string; date: string }`

- [ ] **Step 1: Write the failing tests.** In `apps/ingest/test/build.test.ts`, under `describe("corrections (Plan 6b)")`:
  - **Fix choices.**
    - Two Drive docs: the question has `fix: { type: "pick", source: "drive", choices: [{ id: "g1", name: … }, { id: "g2", name: … }] }`.
    - Two Paper docs: the same, with `source: "paper"`.
    - Two Box folders: the same, with `source: "box"`.
    - A special-folder audio question has `fix: { type: "hours", choices: <the folder's wavs as {id,name}, at most 20> }`.
    - A date-mismatch question has `fix: { type: "stamp", folderDate, stampDate }`.
    - Unreadable lines, a missing hour, or too many tracks have `fix: { type: "tracklist" }`.
  - **Picks apply.**
    - `{ drive: "g2" }` → the tracklist comes from g2 and there is no duplicate question.
    - `{ paper: "p2" }` → the notes come from p2.
    - `{ box: "f2" }` → the audio comes from folder f2.
  - **The typed tracklist.**
    - `{ tracklistText: "HOUR 1\nA - \"One\"\nHOUR 2\nB - \"Two\"" }` → tracks A/One and B/Two, both `closing-track`. No tracklist questions, even when Drive has a broken line or two docs.
    - Paper's spelling never applies to it: Paper `Á – "Óne"` leaves `A - "One"`.
  - **Hours and stamp.**
    - `{ hours: { hour1: "w2", hour2: "w1" } }` on a special folder → `audio.status "ready"`, with `hour1.id "w2"` and `hour2.id "w1"`, no audio question, and `pattern "picked"`.
    - `{ folderDate: true }` on a date mismatch → `audio.status "ready"` and no date question. The rerun hint from the stamp is still asked.
  - **Stale corrections (Review Focus 1).**
    - `{ drive: "gone" }` with docs g1/g2 → the duplicate question is back, and `corrected.stale` is true.
    - `{ hours: { hour1: "w9", hour2: "w1" } }` with no w9 → the special-folder question is back, and the correction is stale.
  - **The Drive text is kept for the editor.** The picked Drive doc's text is in `tracklist.text`, capped at 20,000 characters. With two docs and no pick, there is no `text`.
  - **Undated names**, in `apps/ingest/test/scan.test.ts`:
    - A Paper doc named `Rhythm Lab Radio 9-4-226` is reported as `unplaced` with `{ source: "paper", id, name, reason }`. A name with "No date found in the title." is not reported (old one-offs such as `Rhythm Lab Radio 11`).
    - With a placement `{ source: "paper", id, date: "2026-09-04" }`, the same doc becomes the 2026-09-04 notes and is no longer unplaced.
    - The same applies to Drive docs and Box folders.
- [ ] **Step 2: Run the tests and watch them fail.** Run: `pnpm --filter @aircheck/ingest exec vitest run test/build.test.ts test/scan.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
  - Move `parseDrive` to core as `parseDriveTracklist`, with a one-line core test that a title line above HOUR 1 is not bad.
  - In `buildEpisodes`, look up each date's correction and filter `found` by any picks before calling `audioOf`, `notesOf` and `tracklistOf`.
  - A `tracklistText` correction replaces the Drive branch: parse it with `parseDriveTracklist`, mark tracks with the no-Paper statuses, and use `docId: "air-check"`.
  - `hours` and `folderDate` are applied inside `audioOf`.
  - A correction whose target is missing is ignored and marks the episode `corrected.stale`.
  - `readBox` fills `wavs` from the same file list it already reads.
- [ ] **Step 4: Run the tests and watch them pass.** Run the ingest tests, then `pnpm --filter @aircheck/core exec vitest run`. Both must be green, including the 10-2-26 golden test.
- [ ] **Step 5: Commit.** `feat: corrections and fix choices in the scanner's rules (Plan 6b)`

### Task 2: Corrections in Convex (`apps/console/convex/`)

**Files:**
- Create: `apps/console/convex/corrections.ts`
- Modify: `schema.ts`, `episodes.ts` (export `requireRealHuman`, rows, attempts), `ingest.ts` (list, prune, requestDraft), `hardRule1.test.ts`
- Test: `apps/console/convex/corrections.test.ts`, `ingest.test.ts`, `episodes.test.ts`

**Interfaces:**
- Consumes: Task 1's `Fix`, `Correction` and `parseDriveTracklist`.
- Produces:
  - **Schema.**
    - `fixV` mirrors `Fix`. Questions in `scannedEpisodeFields` and in the `episodes` table gain `fix: v.optional(fixV)`.
    - `tracklist` gains `text: v.optional(v.string())`.
    - A new table `corrections` with `Correction`'s fields, indexed `by_showDate`.
  - **Mutations**, each on `requireRealHuman` and each touching only `updatedAt` plus its own field:
    - `corrections.setTracklist({ showDate, text })`
    - `corrections.pick({ showDate, source, id })`
    - `corrections.setHours({ showDate, hour1, hour2 })`
    - `corrections.useFolderDate({ showDate })`
    - `corrections.clear({ showDate })`
  - **Query.** `corrections.tracklistText({ showDate }) → { text: string; from: "air-check" | "drive" | "tracks" | "none" }`. It returns the correction text if there is one, else the stored Drive text, else `formatTracklist(stored tracks)`, else "". Real human only; anyone else gets null.
  - **`episodes.list` rows** gain `corrected: { fields: ("tracklist" | "drive" | "paper" | "box" | "hours" | "folderDate")[]; at: number } | null`. They never include `tracklist.text`.
  - **`ingest.list`** gains `corrections: Correction[]`, `placements: Placement[]` and `rescanAfter: number` (the newest `updatedAt` across both tables, or 0).
  - **Undated names.**
    - Table `unplaced` (`Unplaced` fields plus `seenAt`), replaced whole by `ingest.reportUnplaced({ token, items })` after each complete scan.
    - Table `placements` (`Placement` fields plus `updatedAt`), indexed `by_source_id`.
    - `corrections.place({ source, id, date })`: real human only. The `source`/`id` pair must be a current `unplaced` row (Review Focus 5), and `date` must be a 2026 `isShowDate`.
    - `corrections.unplace({ source, id })`.
    - `episodes.unplaced()`: real human only; null for anyone else.

- [ ] **Step 1: Write the failing tests.** In `corrections.test.ts`:
  - **Access.**
    - The demo, signed-out and outside users get FORBIDDEN on every mutation, and null from the query.
  - **Typed tracklists (Review Focus 4).**
    - `setTracklist` accepts a 2-hour text.
    - It refuses each of these as BAD_INPUT, with the parser's plain issue in the message: one hour only, a `no dash` line, 101 tracks, over 20,000 characters.
  - **Forged choices (Review Focus 5).**
    - `pick` accepts only an id in the show's question's `fix.choices` for that source.
    - `setHours` accepts only two different ids from the `hours` choices.
    - `useFolderDate` works only when a `stamp` question exists.
  - **Frozen shows.** Every mutation refuses a show with a package, or with an open draft run.
  - **Undo.** `clear` deletes the row.
  - **The editor's text.** `tracklistText` falls back correction → Drive text → formatted tracks → "".

  In `ingest.test.ts`:
  - `list` returns `corrections` and `rescanAfter`.
  - `prune` keeps a date that has a correction.
  - **A fresh start after a fix (Review Focus 3).** For a show with two finished runs, `requestDraft` returns `reason: "draft-failed"`. After a correction made later, it queues, because only runs created after the correction's `updatedAt` count. `episodes.list` reports `draftAttempts` the same way.

  In `episodes.test.ts`:
  - `list` rows carry `corrected`, and never `tracklist.text`.

  For undated names:
  - `place` refuses an id that is not in `unplaced`, a 2025 date, and `2026-02-30`.
  - `reportUnplaced` is INGEST_TOKEN only.
  - `ingest.list` returns the placements.

  In `hardRule1.test.ts`:
  - Add the seven mutations to the public-writes allowlist: the five corrections ones, plus `place` and `unplace`.
- [ ] **Step 2: Run the tests and watch them fail.** Run: `pnpm --filter console exec vitest run convex/corrections.test.ts convex/ingest.test.ts convex/episodes.test.ts convex/hardRule1.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.**
  - Factor one helper, `attemptsSince(ctx, showDate)`, in `episodes.ts`. It counts finished draft runs created after the show's correction `updatedAt`, and both `episodeRows` and `requestDraft` use it.
  - Validate tracklist text with core's `parseDriveTracklist` plus the two caps.
- [ ] **Step 4: Run the tests and watch them pass.** Run the four files, then all console tests. Expected: green.
- [ ] **Step 5: Commit.** `feat: corrections table, human-only mutations, fresh attempts after a fix (Plan 6b)`

### Task 3: The scanner uses corrections and rescans on a save (`apps/ingest/src/`)

**Files:**
- Modify: `convex.ts` (list types), `scan.ts`, `main.ts`
- Test: `apps/ingest/test/scan.test.ts`, `apps/ingest/test/world.ts` (fake Convex: corrections and rescanAfter)

**Interfaces:**
- Consumes: Task 2's `ingest.list` shape and Task 1's `buildEpisodes(…, corrections)`.
- Produces:
  - `runScan(deps)` passes `list().placements` to the readers, sends `reportUnplaced` after a complete scan, and passes `list().corrections` to `buildEpisodes`. It skips at once (no second scan) while another scan is running, and records `memory.lastScanStartedAt`.
  - `rescanIfAsked(deps): Promise<void>` runs `runScan` when `list().rescanAfter > memory.lastScanStartedAt`.
  - `main.ts`'s 60-second pass calls `rescanIfAsked(scanDeps)` before `fetchPass`.
  - A stale correction logs `ingest date=<d> step=correction stale=true`, with no ids or names.

- [ ] **Step 1: Write the failing tests.**
  - **A save triggers one rescan.**
    - The fake Convex returns `rescanAfter` newer than the last scan → one `runScan` within one pass.
    - Five saves before the pass → still one scan (Review Focus 2).
    - A pass while the hourly scan is still running → no second concurrent scan; the next pass catches up.
  - **Corrections reach the stored rows.** A correction `{ tracklistText }` → the upserted episode has the typed tracks and no tracklist questions.
  - **The stale log line** contains no file names.
- [ ] **Step 2: Run the tests and watch them fail.** Run: `pnpm --filter @aircheck/ingest exec vitest run test/scan.test.ts`.
- [ ] **Step 3: Implement.** Add a single shared `memory.scanning` flag so both timers go through one gate.
- [ ] **Step 4: Run the tests and watch them pass.** Run all ingest tests, then `pnpm --filter @aircheck/ingest build`.
- [ ] **Step 5: Commit.** `feat: scanner applies corrections and rescans after a save (Plan 6b)`

### Task 4: Fix it on the Episodes page (`apps/console/src/`)

Run the Impeccable design skill against `PRODUCT.md` and `DESIGN.md` first. The work has to read well in the stacked phone cards (R15) as well as the table.

**Files:**
- Create: `components/FixControl.tsx` and `components/TracklistFix.tsx`, with tests beside them
- Modify:
  - `components/TracklistEditor.tsx`: export its line preview as `TracklistPreview({ text })`, and make TracklistEditor use it, with no behaviour change.
  - `components/EpisodeControls.tsx`, `components/EpisodeItem.tsx`, `EpisodesView.tsx`, `lib/episodes.ts` (labels).

**Interfaces:**
- Consumes: Task 2's mutations, its query and the `corrected` rows; Task 1's `Fix` (mirrored in the component's `Question` type).
- Produces: `EpisodeActions` gains `setTracklist`, `pick`, `setHours`, `useFolderDate` and `clearCorrection`.

- [ ] **Step 1: Write the failing component tests.**
  - **Fix controls under each question:**
    - **pick:** "Use this one" beside each choice's name, which calls `pick`.
    - **hours:** two selects labelled "Hour 1" and "Hour 2"; Save is disabled until two different files are chosen, then calls `setHours`.
    - **stamp:** the button "This show is <folderDate>", which calls `useFolderDate`. The rerun question stays as it is.
    - **tracklist:** "Fix the tracklist" opens `TracklistFix`.
  - **TracklistFix:**
    - Pre-filled from `tracklistText`.
    - Shows the `TracklistPreview` line check live, and Save is disabled while a line is bad or an hour is empty.
    - On save it announces "Saved. Checking again in a minute or two."
  - **Edit tracklist on the row.** Offered on rows with no package, no open run and no rerun mark, so a typo like "Donalyd Byrd" can be fixed without any question.
  - **The corrected line.**
    - A corrected row reads "Corrected in Air Check" followed by the fields in words.
    - "Use Drive again" asks once more ("Your fix will be removed") before calling `clearCorrection`.
    - A stale correction (Review Focus 1) reads "Your fix no longer matches Drive. Use Drive again or fix it again."
  - **Hand-copy text.** The R5 hand-copy wording is replaced by the hours picker wherever an `hours` fix exists.
  - **Undated names.**
    - Above the table, "Couldn't tell the date of these" lists each item: its source, its name, and "This is the show for…" (a 2026 date input) plus Save, which calls `place`.
    - A placed item disappears after the rescan.
    - With nothing unplaced, the section is absent.
  - **Phone cards.** The card layout renders the same controls.
  - **Demo.** Unchanged (no backlog).
- [ ] **Step 2: Run the tests and watch them fail.** Run: `pnpm --filter console exec vitest run src/components`.
- [ ] **Step 3: Implement.** Match the existing `EpisodeControls` patterns: `useSave`, `errorText`, the aria-live announce, and SECONDARY buttons.
- [ ] **Step 4: Run the checks.**
  - The focused tests, the full `pnpm test`, and `pnpm typecheck`.
  - The console `next build`.
  - One desktop screenshot and one 390 px phone screenshot, recorded in the report.
- [ ] **Step 5: Commit.** `feat: fix backlog problems on the Episodes page (Plan 6b)`

### Task 5: Live and docs (controller, with Tarik's go per step)

1. **Merge.** PR, green checks, merge.
2. **Deploy, in order.** Convex (`npx convex deploy -y`) → console (`dc up -d --build`) → ingest bundle, with a backup and a restart. Convex goes first because the scanner sends `fix` and `tracklist.text`.
3. **Tarik checks live.**
   - On April 17, "Edit tracklist" fixes "Donalyd Byrd" → "Donald Byrd".
   - After the rescan, the row is ready with two fresh attempts. The draft goes through, which also confirms PR #16's capitals fix.
   - One duplicate-doc question is settled with "Use this one".
   - `Rhythm Lab Radio 9-4-226` is placed on 2026-09-04, and that show's notes turn Found.
4. **Docs.**
   - Decision 017's "What actually happened" stays blank for Tarik.
   - `docs/ARCHITECTURE.md` gets a corrections paragraph in the ingest section.
   - `skills/rlr-source-reconciliation/SKILL.md`: a short "Corrections" rule (an Air Check correction wins over the source until cleared).
   - `docs/DEPLOY.md`: the deploy order and the hand-copy fallback marked as last resort.
   - `docs/LEARNING-LOG.md`, with "In my words" blank.
