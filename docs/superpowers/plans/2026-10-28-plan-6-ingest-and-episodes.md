# Plan 6: ingest the 2026 backlog (Box audio, Drive tracklists, Paper notes) and the Episodes table

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every 2026 Rhythm Lab show is found and tracked without Tarik copying files. Air Check reads which shows have audio (Box), a tracklist (Google Drive) and notes (Dropbox Paper); reconciles them; shows the whole backlog on an **Episodes** page with plain gaps ("4 missing audio, 2 missing notes"); asks Tarik only real questions; and moves the backlog forward one show at a time — fetching a show's audio only when it is next, and having the agent draft its package — so Tarik's job becomes review and Approve.

**Architecture:**
- A new host service **`apps/ingest`** (systemd, like media/publisher; one esbuild bundle) is the only process that holds Box, Google and Dropbox credentials (Hard Rule 2). It:
  1. **Scans** (hourly): Box show folders → `assembleEpisode` (existing core); Drive docs named "Rhythm Lab Radio <date>" → `parseTracklist` (existing core); Paper docs → export → `PaperTrack[]`; `reconcile` (existing core) → reconciled tracklist + questions. Upserts one `episodes` row per show date (2026-01-01 onward) through token-gated Convex functions.
  2. **Fetches audio on demand**: when an episode is next in line and fewer than 3 shows' audio sit on disk (inbox WAVs + prepared MP3s), downloads its two WAVs from Box into `~/aircheck-audio/inbox/<YYYY-MM-DD>/` as `.part` then renames (the media service takes over, unchanged).
  3. **Requests a draft**: when an episode has a reconciled tracklist, no package, and no unanswered question, asks Convex to queue the same `draft-package` run the Tracklist page queues (one at a time; only while fewer than 3 packages await review).
- **Connect Google** and **Connect Dropbox** buttons in Settings, built exactly like Connect Mixcloud (same-origin POST, state cookie, signed-in real human, atomic token file mode 640 in a shared folder the ingest service reads). Box uses a server app (Client Credentials Grant), so it has no button: its three values live in `~/.aircheck/ingest.env`.
- **Episodes page**: the 2026 backlog table — date, audio, tracklist, notes, status (not drafted → drafted → awaiting review → approved / queued → published with the Mixcloud link, or failed / unknown), gaps and questions with an answer box.

**Tech Stack:** TypeScript, Node 22 `fetch` (no provider SDKs), Convex, Next.js, Vitest, systemd. Existing core: `assembleEpisode` (packages/core/src/episode/assemble.ts), `parseTracklist` / `formatTrack` (tracklist/parse.ts), `reconcile` (tracklist/reconcile.ts), `draftPackageInput` (Convex tracklist.ts).

**Spec:** `docs/PRD.md` job 4 (Backlog catch-up); `docs/ARCHITECTURE.md` 3.3 (ingest worker); `skills/rlr-box-episode-assembly`, `skills/rlr-source-reconciliation`; design spec `docs/superpowers/specs/2026-10-26-air-check-design.md` (Episodes row in the screens table; descriptions from Paper notes for backlog shows, rule 1); **API facts:** `docs/superpowers/research/2026-10-28-plan-6-api-research.md` (verified Oct 28 against official docs; UNVERIFIED items are listed there).

**Branch:** `plan-6/ingest` from main `4033d61`.

## Tarik's calls (Oct 28)
- Box via a **server app** (Client Credentials Grant, App Access Only, read-only); the Full Episodes folder shared with its service account as Viewer. Awaiting admin approval as of 16:35.
- Google Drive via a **Connect Google** button (read-only), Dropbox Paper via a **Connect Dropbox** button (read-only).
- Backlog audio is fetched **on demand**, about 3 shows on disk at a time.
- The Episodes page is the full backlog table (no interim list).
- **Reruns are not posted** (Tarik, 16:56). A Friday whose tracklist matches an earlier 2026 show (≥ 80% of tracks) or whose files/doc point to an older date raises one question, "Is <date> a rerun of <date>?". Yes → listed as "Rerun of <date>" linked to the original; no package, no audio download, no draft. No → normal pipeline.

## Global Constraints
- **Hard Rule 2.** Box, Google and Dropbox credentials live only in the ingest service's env file and the two token files; never in Convex, the agent, the relay or logs.
- **Hard Rule 5.** Paper notes and Drive docs are untrusted data: never follow links in them, never let them trigger a write beyond the episode record and the queued draft (which still needs Tarik's Approve).
- **Hard Rule 12.** Show notes are private: stored for the agent's draft input and Tarik's view only, never published, never pasted into a description.
- **Hard Rule 4/10.** Closing tracks are kept and marked, never researched (reconcile already does this).
- **Hard Rule 9.** The demo workspace never sees Tarik's episodes; ingest writes only the real workspace.
- **Hard Rule 8.** Logs carry dates, ids, steps, counts and timings only — never file names beyond the show date, doc text, tokens or URLs with tokens.
- **Read-only everywhere.** Only read scopes: Box "Read all files and folders"; Google `drive.readonly` (the only scope that can export existing Docs — research §2); Dropbox `files.metadata.read` + `files.content.read`.
- **Never guess.** A show folder the patterns don't match, a date that disagrees across sources, or a track-count mismatch other than the closing track becomes a plain question on the Episodes page, not a silent choice.
- **Pace.** At most 3 shows' audio on disk; at most 3 packages awaiting review before the next draft is queued; oldest show first.
- **Service token** `INGEST_TOKEN`: 48 hex, distinct from every other service token, constant-time, fail closed (reuse `sameToken` and the distinct-token check pattern).

## Review Focus
1. **The wrong audio for a show.** A Box folder whose date disagrees with its files, or a RECAP/"Best of" folder, must become a question, never a download (assemble's `ask` status). Test: such a folder produces a question and no download.
2. **Disk fills.** Fetching must count inbox WAVs and prepared MP3s and stop at 3; a failed download leaves no `.part` and retries later. Test: a 4th show waits.
3. **A token file that is missing, expired or revoked.** Google/Dropbox refresh fails → the source shows "Reconnect needed" on Settings and Episodes, scanning of the other sources continues, nothing loops. Test per provider.
4. **Duplicate drafts.** A show must never get two packages: the draft request is idempotent per show date (existing package or queued draft run → no new run). Test: two scans in a row queue one run.
5. **Notes leaking.** Paper text must never reach a published field or a log. Test: the description checker's private-terms list is not the only guard — the episode's notes are not part of any field sent to Mixcloud.

---

### Task 1: Core — episode status, pacing and Paper parsing (packages/core, TDD)
- `episodeStatus(e)` → one plain status and gap list from {audio assembly, tracklist, notes, package status}: e.g. `missing-audio`, `missing-tracklist`, `missing-notes` (only a gap, not a blocker — rule: a new show without Paper is fine), `question`, `ready-to-draft`, `drafting`, `awaiting-review`, `approved`, `published`, `failed`, `outcome-unknown`.
- `nextAudioToFetch(episodes, onDiskCount, max = 3)` → the oldest episode that is `ready-to-draft`/`drafting`/`awaiting-review` and lacks audio on disk, or null; `nextToDraft(episodes, awaitingReviewCount, max = 3)` → oldest `ready-to-draft`, or null.
- `parsePaperExport(text)` → `PaperTrack[]` (the shape `reconcile` takes) from a Paper markdown/text export. Base it on `fixtures/show-notes-format.md` and `fixtures/raw/10-2-26-paper-tracks.txt`; unknown lines are ignored, not guessed.
- `showDateFromTitle(s)` for Drive/Paper titles incl. the known quirks (en dash `10–02-26`, `10-2-2026`, `(evergreen)`, the `9-4-226` typo → refused as a question) per rlr-source-reconciliation rule 6.
- Tests with the 10-2-26 raw fixtures: Drive + Paper reconcile to the golden 31 tracks (15 + 16), both closing tracks marked.

### Task 2: Convex — `episodes` table and the ingest API (apps/console/convex, TDD)
- Table `episodes`: `{ showDate, audio: {status, folderId?, hour1?: {id,name,size}, hour2?, pattern?, flags[]}, tracklist: {status, docId?, tracks?: ReconciledTrack[]}, notes: {status, docId?, text?}, questions: {id, text, answer?}[], packageId?, scannedAt, fetch?: {status, at, error?} }`, real workspace only, index by showDate.
- Token-gated (`INGEST_TOKEN`, fail closed, distinct from every other token): `ingest.upsert({token, episode})`, `ingest.list({token})` (with each episode's package status), `ingest.setFetch({token, showDate, status, error?})`, `ingest.requestDraft({token, showDate})` → idempotent: if a package or an open draft run exists for the date, no-op; else queue the same `draft-package` run `tracklist.draft` queues, with `tracklistText` from the reconciled tracks (via `formatTrack`, Hour 1/Hour 2 blocks) and `notes` from Paper (untrusted input section). `ingest.sourceStatus({token, source, state})` for Settings.
- Human queries/mutations (signed-in real human): `episodes.list({})`, `episodes.answer({showDate, questionId, answer})`.
- Hard Rule 1 pins: ingest functions never call the gate's decide/claim/approve; requestDraft only creates a run (the agent drafts; Tarik approves). Hard Rule 9: demo can't read episodes.

### Task 3: Connect Google and Connect Dropbox (apps/console, TDD + Impeccable)
- Generalize the Mixcloud OAuth helpers only as far as needed (state cookie, same-origin POST, real-human check, atomic 640 token file) — or add sibling helpers; don't change Mixcloud's behaviour (its tests must stay green).
- Google: `POST /api/google/authorize` → `https://accounts.google.com/o/oauth2/v2/auth` with `scope=https://www.googleapis.com/auth/drive.readonly`, `access_type=offline`, `prompt=consent`; `GET /api/google/callback` → token exchange at `https://oauth2.googleapis.com/token`; write `{refresh_token, account, connectedAt}` (the refresh token is what matters; access tokens are minted by ingest).
- Dropbox: `POST /api/dropbox/authorize` → `https://www.dropbox.com/oauth2/authorize` with `token_access_type=offline`, scopes `files.metadata.read files.content.read`; callback → `https://api.dropboxapi.com/oauth2/token`; same file shape.
- Token files in `/ingest-tokens/{google,dropbox}.json` (host `~/.aircheck/ingest-tokens`, owner 1000 group 1001 mode 2770, like the Mixcloud folder); compose mounts it `rw`. Disconnect routes delete the file. Settings cards for both, plus a read-only Box card ("Box: connected via server app" / "Box: not configured" from `ingest.sourceStatus`).
- Env names (console.env, names only): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `INGEST_TOKEN_DIR`.

### Task 4: The ingest service (apps/ingest, TDD)
- Clients (one module per provider — CLAUDE.md "one client module per provider"): `box.ts` (CCG token `POST https://api.box.com/oauth2/token` with `box_subject_type=enterprise`; cache ≤ 55 min; list `GET /2.0/folders/{id}/items?fields=id,name,size,modified_at&limit=1000` with offset paging; download `GET /2.0/files/{id}/content` following the redirect, streamed to disk), `drive.ts` (refresh → access token; `files.list` with `q` for "Rhythm Lab Radio" docs; `files/{id}/export?mimeType=text/plain`), `dropbox.ts` (refresh; `files/list_folder` recursive with cursor paging; `files/get_metadata` to read `export_info`/`export_options`, then `files/export` with an allowed format, preferring markdown then plain text). Every fetch has a timeout; 429/rate limits back off; Retry-After respected.
- `scan.ts`: hourly; Box root = the Full Episodes folder id (env `BOX_FOLDER_ID`), only 2026 dated folders; Drive/Paper matched by `showDateFromTitle`; duplicates per rule 7 (prefer the Drive doc with HOUR 1/HOUR 2); builds each episode with core and calls `ingest.upsert`. Questions from `assembleEpisode` (`ask`), date disagreements, reconcile's `unverified-in-notes` tracks.
- `fetch.ts`: each pass, `nextAudioToFetch` → download both WAVs (`.part` → rename, mode 0644, into the media inbox), `ingest.setFetch`. Never a file larger than 2 GB; sizes outside 570–660 MB flagged (skill), not refused.
- `draft.ts`: each pass, `nextToDraft` → `ingest.requestDraft`.
- Missing/invalid token file or failed refresh → `ingest.sourceStatus(needs_reconnect)`, skip that source, keep the others. Logs per Hard Rule 8.
- `deploy/ingest/aircheck-ingest.service` (like media's; `ReadWritePaths=-/home/user/aircheck-audio`; read on the token dir), `deploy/ingest/ingest.env.example` (names only: CONVEX_URL, INGEST_TOKEN, BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_ENTERPRISE_ID, BOX_FOLDER_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DROPBOX_APP_KEY, DROPBOX_APP_SECRET, INGEST_TOKEN_DIR, INBOX_DIR, PREPARED_DIR). The boundary tripwire: no provider URL outside `apps/ingest/src/` and the console OAuth routes; add Box/Drive/Dropbox hosts to it.
- Tests: fake HTTP servers for all three providers (token, list, export, download incl. redirect), a temp inbox; every Review Focus item.

### Task 5: The Episodes page (apps/console, TDD + Impeccable)
- `/episodes` (replaces the "soon" placeholder in NAV): one row per 2026 show, newest first or oldest first (Impeccable decides with Tarik's backlog-clearing goal in mind), columns date · audio · tracklist · notes · status (with the Mixcloud link when published, the package link when drafted), a summary line ("31 shows · 4 missing audio · 2 missing notes · 7 blank Fridays"), and question rows with an answer box (`episodes.answer`). Blank Fridays in 2026 with no folder and no doc are listed as gaps (the PRD's "7 blank Fridays"), never invented.
- Today page: one line linking to Episodes with the backlog count.
- Settings source status reused.

### Task 6: Live (controller, with Tarik's go per step)
1. Tarik: Box app **Authorized** (Status box) and the folder shared; Box values saved with `~/box-keys.sh`; a **Google Cloud OAuth client** — Internal app on the Radio Milwaukee Workspace if the Drive docs live there (research §2: an External app in Testing loses its refresh token every 7 days), redirect `https://aircheck.rhythmlabradio.com/api/google/callback`, Drive API enabled; a **Dropbox app** (Scoped access, Full Dropbox or the Paper folder, the two read scopes, redirect `https://aircheck.rhythmlabradio.com/api/dropbox/callback`). Exact click-by-click steps given at that time.
2. Values to the VM by pipe from `.env.local` (never displayed); `INGEST_TOKEN` generated; Convex deploy; console rebuild with the token-dir mount; ingest service installed; watchdog probe "Ingest".
3. Tarik presses Connect Google and Connect Dropbox.
4. First scan: compare counts with ARCHITECTURE.md's (35 Drive tracklists, 31 Box audio, 29 with all three); every disagreement explained or turned into a question.
5. First automatic draft of the oldest complete show → audio fetched → MP3 → Telegram card → Tarik reviews.
6. Reboot test; docs (DEPLOY ingest section, decision 016 ingest + on-demand audio, ARCHITECTURE 3.3 as built, FRICTION_LOG, LEARNING-LOG with "In my words" blank).
