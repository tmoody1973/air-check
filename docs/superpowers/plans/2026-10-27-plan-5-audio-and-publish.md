# Plan 5: audio and publish (the show reaches Mixcloud)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drafted package becomes a real Mixcloud show with nothing done by hand except Tarik's approval. Two hour files are joined into the MP3 Tarik previews in the console, the package turns approvable, and Approve publishes it publicly with title, tags, description, tracklist sections (no times) and cover art. A receipt comes back, and Telegram announces each package that is ready to review.

**Architecture:**
- Two new host programs on the VM, built like the relay (systemd units, one bundled file each, a token-gated Convex API, logs that carry no content):
  - **`apps/media`** watches an audio inbox, joins and encodes with ffmpeg, and attaches the MP3's fingerprint to the package.
  - **`apps/publisher`** uploads approved packages to Mixcloud, at most 3 per day, oldest first, and writes the receipt.
- The console gains a "Connect Mixcloud" flow. It writes the token to a locked file that only the publisher reads; the token is never stored in Convex.
- The console gains an audio route that streams the prepared MP3 to signed-in staff for the player.
- The existing approval gate (`approval.ts`) stays the only path to publishing: `claimForPublish` accepts only `approved`, real-workspace packages.

**Tech Stack:** TypeScript, Node 22, esbuild bundles, Convex, Next.js App Router, ffmpeg/ffprobe on the VM, Mixcloud API (`POST https://api.mixcloud.com/upload/` multipart, OAuth 2.0 browser flow), Telegram Bot API (send only), Vitest.

**Spec:**
- `docs/superpowers/specs/2026-10-26-air-check-design.md` 5.1 (phone approval, Telegram link-only cards), 5.7 item 2 (approve publishes publicly, backlog oldest first, at most 3 per day, standard cover unless Tarik picks another), 5.8 (audio joined at draft time, MP3 hash in the fingerprint, the player, storage of at most 3 prepared MP3s, MP3 deleted after Skip or publish), 7.1 (approval gate), 8 steps 5–9.
- `docs/ARCHITECTURE.md` 3.4 (media worker) and 3.5 (publisher).
- `docs/PRD.md` jobs 2 and 3.
- The Mixcloud developer docs (fetched 2026-10-27): browser-only OAuth; `access_token` as a query parameter; revocable tokens; upload fields `mp3` (≤4 GB), `name`, `description` (≤1,000), `tags-0..4-tag`, `picture` (≤10 MB), `unlisted`, `sections-X-artist/song` (start time optional); rate limit is HTTP 403 with `Retry-After`.

**Branch:** `plan-5/publish` from main `f0db01a`.

**Tarik's calls (Oct 27):**
- Build the full product; no deadline cuts.
- Audio arrives by copying the WAVs into a VM inbox. Box ingest comes in Plan 6 alongside it.
- ffmpeg runs on the VM, not a Nebius Serverless Job. This reverses Oct 26 and must be written up in the decision and the README.
- The first upload is an unlisted test.
- Mixcloud is connected with a "Connect Mixcloud" button in the console.

## Global Constraints

- **Hard Rule 1.** Only a package Tarik approved in the signed-in console can be uploaded. The publisher calls only `claimForPublish`, which accepts only `status: "approved"` in the real workspace. No agent, relay or media code path reaches the publisher functions. `hardRule1.test.ts` grows to pin the new functions and their source isolation.
- **Hard Rule 2.** No Mixcloud credential ever reaches the agent, the relay or Convex.
  - The client secret lives only in `console.env`.
  - The access token lives only in a token file that the console writes and the publisher reads, mode 640.
- **Hard Rule 9.** Demo packages never publish: the gate already refuses them, and the publisher re-checks `workspace === "real"`.
- **Hard Rule 11.** No `start_time` is ever sent. `toMixcloudFields` already guarantees this, and a test pins it.
- **Hard Rule 8.** Service logs carry ids, statuses and counts only. Never tokens, titles, descriptions or file paths beyond the package id.
- **Service tokens.** `MEDIA_TOKEN` and `PUBLISHER_TOKEN` are each 48 hex characters, distinct from each other and from `RELAY_TOKEN`, `AGENT_SUBMIT_TOKEN` and `DEMO_AGENT_SUBMIT_TOKEN`. Each is checked in constant time and fails closed (minimum 32 characters).
- **Pacing.** At most `PUBLISH_PER_DAY = 3` uploads per America/Chicago calendar day, oldest `showDate` first.
- **Prepared audio.** At most `MAX_PREPARED = 3` MP3s on disk. The MP3 is encoded at 192 kbps CBR (as in spike V10).
- **No auto-retry after an upload has started.** An upload whose outcome is unknown is never retried automatically. It becomes `outcome_unknown` for Tarik to resolve, so a show can never be posted twice.
- **Never fail silently.** Every waiting or blocked state shows in the console with a plain reason.
- **Docs.** Follow Along voice. The decision uses the CLAUDE.md format, with "What actually happened" left blank.

## Review Focus

1. **A double public post.** The publisher crashes or the network drops mid-upload. It must not upload again: the package goes `outcome_unknown` and Tarik checks Mixcloud. A restart reconciles `publishing` packages to `outcome_unknown`, never back to approved (Task 5 test).
2. **The MP3 on disk is not the one Tarik previewed.** It was replaced, re-encoded or truncated. The publisher re-hashes the file and refuses the upload if the hash differs from the fingerprinted `mp3Sha256` (Task 5 test).
3. **The Mixcloud token is revoked or invalid.** On "An invalid access token was provided", the publisher stops trying. Mixcloud status becomes `needs_reconnect`, Telegram alerts once, and the package stays approved and queued. Nothing loops (Task 5 test).
4. **The inbox holds something unexpected.** A folder for a date with no draft package, one WAV or three, or non-WAV files. Media reports a plain "waiting" reason in the console and never guesses. Hour order comes from the filename's numeric sort, with ties refused (Task 1 and Task 3 tests).
5. **A fourth approval on the same day.** It waits for tomorrow (Chicago day), oldest first. The package page says "Queued: posts after <date>", and nothing is dropped (Task 1 and Task 6 tests).

---

### Task 1: Core rules for audio and publishing (packages/core, TDD)

**Files:** create `packages/core/src/publish/inbox.ts`, `pacing.ts`, `validate.ts`, `telegramCard.ts`; extend `packages/core/src/index.ts`; tests beside them.

**Interfaces (produces):**
- `matchInbox(folder: string, files: string[]): { ok: true; showDate: string; hour1: string; hour2: string } | { ok: false; reason: string }`
  - The folder name is the show date `YYYY-MM-DD`.
  - Exactly two `.wav` files (case-insensitive); others are ignored but reported.
  - Order is by the numeric value of the leading digits of each filename (`9125.wav` < `9126.wav`), then lexical.
  - Equal keys are refused.
  - The reason is plain English, e.g. "2026-10-02 needs exactly two .wav files; found 1".
- `nextToPublish(approved: { packageId: string; showDate: string; approvedAt: string }[], publishedToday: number, perDay = 3): { packageId: string } | { waitUntil: "tomorrow" } | null`
  - Picks the oldest `showDate` first (ties broken by `approvedAt`).
  - Returns `waitUntil` once `publishedToday >= perDay`.
- `chicagoDayKey(nowMs: number): string`. Reuse the existing Chicago-midnight logic from `apps/console/convex/demoLimits.ts` if it can move into core cleanly; otherwise mirror it with the same tests.
- `validateForUpload(draft: PackageDraft, opts: { mp3Bytes: number; pictureBytes?: number }): string[]`. Covers everything Mixcloud checks only after the full upload:
  - name present and under 100 characters;
  - description ≤ 1,000 code points;
  - ≤ 5 non-empty tags;
  - every section has an artist and a song;
  - mp3 ≤ 4.0 GB;
  - picture ≤ 10 MB.
  - An empty array means it is OK to upload.
- `readyCard(p: { title: string; trackCount: number; flagCount: number; packageId: string; appUrl: string }): string`. A plain-text Telegram message: the title, "31 tracks · 0 flags", and a "Review package" link to `<appUrl>/packages/<id>`. No approve wording, no buttons (spec 5.1).

- [ ] **Step 1: Failing tests.**
  - `matchInbox`:
    - `9125.wav`/`9126.wav` gives hour1 9125;
    - `B.WAV`/`a.wav` with no digits gives lexical order;
    - one file → reason;
    - three files → reason;
    - equal numeric keys → reason;
    - a bad folder name → reason.
  - `nextToPublish`:
    - the oldest of three is picked;
    - `publishedToday` 3 → `waitUntil`;
    - an empty list → null.
  - `chicagoDayKey`: across CDT and CST, and across midnight.
  - `validateForUpload`:
    - the golden 10-2-26 draft gives `[]`;
    - a 1,001-character description gives one problem;
    - 6 tags → a problem;
    - a 4.1 GB mp3 → a problem.
  - `readyCard`: contains the link and the counts, and does not contain "approve" (case-insensitive).
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`.
- [ ] **Step 5:** Commit.

### Task 2: Convex: media and publisher APIs, cover art, Mixcloud status (apps/console/convex, TDD)

**Files:** create `convex/media.ts`, `convex/publisher.ts`, `convex/mixcloud.ts`; modify `schema.ts`, `packages.ts` (cover), `packageStore.ts` if needed, `hardRule1.test.ts`; add tests. Write `docs/decisions/014-media-and-publisher-on-the-vm.md`.

**Interfaces (produces):** every service function takes `token` first and is checked with the existing constant-time `sameToken`. It fails closed when its env token is unset or under 32 characters.

- **Media functions:**
  - `media.pending({token})` → real-workspace packages in `preparing_audio`: `{packageId, showDate}`.
  - `media.attached({token, packageId, hour1Id, hour2Id, mp3Sha256, hour1DurationSec, mp3Bytes})` → calls the gate's `attachAudio`. The real hour ids are the filenames, replacing the agent's `pending-hour-*` (the Plan 4a note: never trust agent hour ids).
  - `media.waiting({token, items: {showDate, reason}[]})` → upserts `audioIssues` rows that the console shows.
  - `media.cleanup({token})` → returns the package ids whose prepared MP3 can be deleted (`skipped`, `succeeded`).
- **Publisher functions:**
  - `publisher.queue({token})` → approved real packages with `{packageId, showDate, decidedAt, draft, fingerprint, coverStorageId?}`, plus `publishedToday` (count of `succeeded` results in the current Chicago day).
  - `publisher.claim({token, packageId})` → `claimForPublish`.
  - `publisher.result({token, packageId, result})` → `recordResult`.
  - `publisher.reconcile({token})` → any package left in `publishing` becomes `outcome_unknown` (Review Focus 1).
  - `publisher.coverUrl({token, storageId})` → a short-lived URL for the cover file.
- **Mixcloud status:**
  - `mixcloud.status` table, one row: `{state: "connected" | "needs_reconnect" | "not_connected", account?: string, connectedAt?, lastError?}`.
  - Written by `publisher.setMixcloud({token, ...})`, and by the console's connect flow through `mixcloud.connected({account})`, a signed-in real human only.
  - Read by `mixcloud.get({})`, real workspace only.
- **Cover:**
  - `packages.setCover({packageId, storageId | null})` is a signed-in real human only, and only while `awaiting_review`.
  - It re-fingerprints, because the cover is part of what goes public. The fingerprint input gains `coverStorageId`; extend `core/fingerprint.ts` and its tests.
  - `packages.coverUploadUrl({})` returns a Convex file-storage upload URL for a signed-in real human.
  - The standard cover is the env `STANDARD_COVER_STORAGE_ID`. When a package has no cover, the publisher uses it.
- **The Hard Rule 1 test:**
  - The public-write allowlist gains exactly these functions.
  - Source checks prove `media.ts`, `publisher.ts` and `mixcloud.ts` never call `decide`, and that the publisher reaches packages only through `claimForPublish` and `recordResult`.
  - A behavioural test: a package that was never approved by `packages.decide` cannot be claimed (`publisher.claim` → NOT_READY).
  - Tokens: `RELAY_TOKEN` and `AGENT_SUBMIT_TOKEN` values are rejected by the media and publisher functions.

- [ ] **Step 1: Failing tests.** All of the above, plus:
  - the fingerprint of a draft with no cover is byte-identical to today's, so packages already awaiting review don't flip to "changed";
  - fail-closed for every service function (env unset or 31 characters, wrong token);
  - `media.attached` on a non-preparing package → NOT_READY;
  - `setCover` after approval → NOT_READY;
  - a demo package never appears in `publisher.queue`;
  - `publishedToday` across Chicago midnight;
  - `reconcile` moves `publishing` to `outcome_unknown` only.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`.
- [ ] **Step 5:** Write decision 014, covering:
  - media and publisher run on the VM;
  - ffmpeg on the VM instead of a Nebius Serverless Job (Tarik's call, Oct 27), with the cost: no serverless story, and the VM does the encoding;
  - the token-file design for Mixcloud.
- [ ] **Step 6:** Commit.

### Task 3: The media service (apps/media, TDD)

**Files:** `apps/media/src/{main,config,convex,inbox,encode}.ts`, tests, `package.json` (esbuild bundle like `apps/relay`), root vitest and typecheck wiring, `deploy/media/aircheck-media.service`, `deploy/media/media.env.example`.

**Behaviour:**
- **The loop.** Every 30 s it scans `INBOX_DIR` (default `/home/user/aircheck-audio/inbox`). For each `YYYY-MM-DD` folder:
  1. Run `matchInbox`.
  2. Find the matching `media.pending` package by `showDate`.
  3. If there is a match and fewer than `MAX_PREPARED` MP3s exist in `PREPARED_DIR`:
     - join the two WAVs in hour order with `ffmpeg` (concat), encoding 192 kbps CBR MP3 to `PREPARED_DIR/<packageId>.mp3.part`, then rename the file into place;
     - measure each WAV's real duration with `ffprobe` (never assume 60:00);
     - hash the MP3 with sha256 (streamed);
     - call `media.attached` with `hour1Id`/`hour2Id` set to the WAV filenames, `hour1DurationSec` and `mp3Bytes`.
- **Problems.** Folders with problems, or with no matching package, are reported through `media.waiting` with the plain reason. The reported list is replaced on every pass, so a fixed problem clears.
- **Cleanup.** Ids from `media.cleanup` get their MP3 and their inbox folder deleted.
- **Process handling.**
  - ffmpeg and ffprobe run through an injectable exec with `execFile` and no shell.
  - A failed encode leaves no `.part` file and is reported as "Encoding failed for <date>; will retry".
  - At most one encode runs at a time.
- **Logs.** Only `media date=<date> package=<id> step=<step> ok=<bool> ms=<n>`.

- [ ] **Step 1: Failing tests.** Use a fake exec, a fake Convex and a temp dir.
  - A matched folder is encoded and attached with the right hour order and durations.
  - A 4th package waits while 3 MP3s are prepared.
  - A failed encode leaves no partial file.
  - A folder without a package is reported, not encoded.
  - Cleanup deletes the MP3 and the inbox folder.
  - No token appears in the logs.
- [ ] **Steps 2–4:** Implement, then run `pnpm test`, `pnpm typecheck`, and `pnpm --filter @aircheck/media build`.
- [ ] **Step 5:** Commit.

### Task 4: Connect Mixcloud in the console (apps/console, TDD + Impeccable)

**Files:**
- `src/app/api/mixcloud/authorize/route.ts` and `src/app/api/mixcloud/callback/route.ts`;
- `src/lib/mixcloudOAuth.ts` (pure helpers) with tests;
- a Settings page `src/app/(console)/settings/page.tsx` with a `MixcloudConnection` component, and a NAV entry;
- `deploy/compose.yaml` (the token mount);
- `console.env` names in `deploy/console.env.example` (if it exists; otherwise DEPLOY.md lists them).

**Behaviour:**
- **Authorize.** Signed-in real human only; demo users get 403.
  - Build the authorize URL `https://www.mixcloud.com/oauth/authorize?client_id=…&redirect_uri=<APP_URL>/api/mixcloud/callback`.
  - Set an `HttpOnly`, `Secure`, `SameSite=Lax` cookie holding a random `state`. Mixcloud does not document `state` round-trip, so the cookie is our CSRF guard, and the callback requires both the cookie and a signed-in real human.
- **Callback.**
  1. Check the cookie and the signed-in real human.
  2. Exchange the code at `https://www.mixcloud.com/oauth/access_token?client_id&redirect_uri&client_secret&code` on the server. The response is `access_token=…` form-encoded (parse both form and JSON, defensively).
  3. Call `GET https://api.mixcloud.com/me/?access_token=…` to get the username.
  4. Write `{access_token, account, connectedAt}` atomically (temp file plus rename) to `MIXCLOUD_TOKEN_FILE` (`/mixcloud/token.json`), mode 640.
  5. Call `mixcloud.connected({account})`.
  6. Redirect to `/settings?mixcloud=connected`.
  - Any failure redirects with a plain error code. The token never appears in a log or URL after the exchange.
- **Settings card.**
  - Shows "Connected as <account> · since <date>", or "Not connected", or "Reconnect needed: Mixcloud says the permission was revoked".
  - Buttons: Connect / Reconnect.
  - "Disconnect" deletes the file through a signed-in POST route and sets `not_connected`.
  - The package page shows "Connect Mixcloud to publish" next to Approve when not connected. Approve stays possible: the package waits in the queue.
- **compose.yaml.** The console gets `- ${HOME}/.aircheck/mixcloud:/mixcloud:rw` (only that directory) and `- ${HOME}/aircheck-audio/prepared:/audio:ro` (for Task 6). The container stays `read_only: true`.
- **Permissions.** The container runs as uid 1000 and the host user is 1001, so DEPLOY documents `~/.aircheck/mixcloud` as owner 1000, group 1001, mode 2770, and the token file 640 group-readable by the publisher. Task 7 verifies this.

- [ ] **Step 1:** Run Impeccable for the Settings card (`PRODUCT.md`, `DESIGN.md`); record the decisions.
- [ ] **Step 2: Failing tests.**
  - URL building and encoding;
  - state cookie mismatch → error;
  - a demo user → 403;
  - token response parsing (form and JSON);
  - the file is written atomically with mode 640 (temp dir);
  - the card shows each of the three states;
  - the Disconnect route deletes the file.
- [ ] **Steps 3–5:** Implement, then run `pnpm test` and `pnpm typecheck`. Commit.

### Task 5: The publisher service (apps/publisher, TDD)

**Files:** `apps/publisher/src/{main,config,convex,mixcloud,telegram}.ts`, tests, an esbuild bundle, root wiring, `deploy/publisher/aircheck-publisher.service`, `deploy/publisher/publisher.env.example`.

**Behaviour:**
- **On start:** `publisher.reconcile` (Review Focus 1).
- **Every 30 s:**
  1. Read `publisher.queue`. Use `nextToPublish` with `publishedToday`.
  2. Read the token file. If there is none: `setMixcloud(not_connected)`, then wait.
  3. `claim`.
  4. Re-hash the prepared MP3 and compare with the fingerprinted `mp3Sha256`. On mismatch: `result failed "audio changed since approval"`, with no upload (Review Focus 2).
  5. Run `validateForUpload`. If there are problems: `result failed <problems>`.
  6. Build the fields with `toMixcloudFields(draft)`, plus `picture` (the package cover, else the standard cover).
  7. **Stream** the multipart upload from disk to `https://api.mixcloud.com/upload/?access_token=…`. The MP3 can be about 140 MB; never buffer the whole file in memory. Use `fs.openAsBlob` with undici `FormData`, or an equivalent streaming body.
- **Responses:**
  - Success: `result succeeded {url}`, built from the response key, then `setMixcloud(connected)`.
  - Rate limit (403 + `Retry-After`) **before** the upload began: wait and retry once. A rate limit is the only retry.
  - Invalid token: `setMixcloud(needs_reconnect)`, and the package goes back to `approved` (unclaim), so it waits safely.
    - This is the one approved exception to "never back to approved". Mixcloud rejects auth **before** accepting audio, so nothing was posted. It needs `publisher.unclaim({token, packageId})`, valid only from `publishing` with the error type `invalid_token`. Add it to Task 2's list as part of this task's TDD, and to the Hard Rule 1 allowlist.
  - A network error or timeout after the body started, or any 5xx: `result outcome_unknown`. Never retried.
- **Telegram cards.**
  - Every 60 s, packages newly in `awaiting_review` get one `readyCard` sent via the Bot API to Tarik's chat. The bot token and chat id are read from `~/.airc/secrets.env` exactly as `deploy/hermes/watchdog.sh` does: only those two values, URL through stdin config or the request body, never in argv.
  - Sent ids are kept in a small state file, so a restart never re-sends.
  - On `needs_reconnect`, send one alert: "Mixcloud needs reconnecting: open Settings".
- **Logs:** `publish package=<id> step=<step> ok=<bool> ms=<n>`, never the token or any content.

- [ ] **Step 1: Failing tests.** Use a fake Mixcloud HTTP server, a fake Convex and a temp dir.
  - Happy path: the fields sent equal `toMixcloudFields` plus a picture, with no `start_time` field anywhere.
  - Hash mismatch → failed, with no upload request.
  - Invalid token → `needs_reconnect` plus unclaim, with no loop.
  - 403 Retry-After → exactly one retry.
  - A dropped connection mid-body → `outcome_unknown`, and no second upload ever.
  - Restart with a `publishing` package → reconciled to `outcome_unknown`.
  - Pacing: the 4th approval in a day is not uploaded.
  - Telegram card sent once per package, not re-sent after a restart.
  - The MP3 is streamed: the test asserts the fake server receives the bytes while the client's resident memory stays under the file size, or uses a stream spy.
  - No token in the logs.
- [ ] **Steps 2–4:** Implement, then run `pnpm test`, `pnpm typecheck`, and `pnpm --filter @aircheck/publisher build`.
- [ ] **Step 5:** Commit.

### Task 6: The package page: real player, cover, queue state, receipt (apps/console, TDD + Impeccable)

**Files:**
- `src/app/api/audio/[packageId]/route.ts` (the stream);
- `src/components/PackageDecision.tsx` and the package page;
- `PlayerProvider`/`PlayerBar` (real source);
- a `CoverPicker` component;
- an `AudioIssues` card on Today;
- tests.

**Behaviour:**
- **Audio route.**
  - Signed-in real human only; demo users get 403. The demo keeps its sample MP3.
  - Streams `/audio/<packageId>.mp3` with `Range` support (206, `Content-Range`, `Accept-Ranges`) and `Cache-Control: private, no-store`.
  - The package id is validated against `/^pkg-\d{1,2}-\d{1,2}-\d{2}$/`, so no path traversal is possible.
  - Missing file → 404 with a plain message.
- **Player.**
  - The package page's play button loads the real MP3.
  - "Jump to hour 2" uses `hour1DurationSec`. That is an hour boundary, not a track time, so Hard Rule 11 holds.
  - Playback survives navigation (the existing provider).
- **Cover.**
  - While `awaiting_review`, show the standard cover with a "Use a different image" upload (≤10 MB, image types). It previews, then calls `setCover`, which re-fingerprints and shows "Changed: review again".
  - After approval, the cover is read-only.
- **Queue and receipt.**
  - When approved but not yet published, show "Queued: posts today" or "Queued: posts after <date> (3 a day, oldest first)", computed from `nextToPublish` data.
  - Not connected → "Connect Mixcloud to publish".
  - `publishing` → "Uploading to Mixcloud…".
  - `succeeded` → the existing receipt with a Mixcloud link, plus time and fingerprint.
  - `failed` → the reason and "Approve again after fixing". Re-approval goes through `decide` on a new revision.
  - `outcome_unknown` → "We don't know if it posted. Check Mixcloud before doing anything," with a link to the account's uploads page.
- **Today.** Lists `audioIssues` rows ("2026-10-09 needs exactly two .wav files; found 1").

- [ ] **Step 1:** Run Impeccable for the package page changes and the Today card.
- [ ] **Step 2: Failing tests.**
  - The route returns 206 for a range and 403 for demo.
  - A path-traversal id → 400.
  - Each queue and receipt state's copy.
  - Cover upload → `setCover` is called and "review again" is shown.
  - Jump to hour 2 seeks to `hour1DurationSec`.
- [ ] **Steps 3–5:** Implement, then run `pnpm test` and `pnpm typecheck`. Commit.

### Task 7: Live on the VM: inbox, media, Mixcloud connect, unlisted spike, first real publish (controller)

- [ ] **Step 1: Tarik's setup.**
  - Add the redirect URL `https://aircheck.rhythmlabradio.com/api/mixcloud/callback` in the Mixcloud app settings.
  - Put `MIXCLOUD_CLIENT_ID` and `MIXCLOUD_CLIENT_SECRET` in `~/.aircheck/console.env`. He enters them himself; their values never pass through Claude.
- [ ] **Step 2: VM.** Announce first: services are installed and the console is rebuilt (about 15 s).
  - Install ffmpeg if it is missing.
  - Create `~/aircheck-audio/{inbox,prepared}` and `~/.aircheck/mixcloud` with the Task 4 ownership.
  - Create `MEDIA_TOKEN` and `PUBLISHER_TOKEN` on prod Convex, the standard cover in Convex storage (Tarik supplies the image) as `STANDARD_COVER_STORAGE_ID`, and the env files.
  - Deploy Convex.
  - Install and start `aircheck-media` and `aircheck-publisher`; rebuild the console with the mounts.
  - Add both services to the watchdog.
- [ ] **Step 3: Tarik copies the 10-2-26 WAVs.** One command in DEPLOY, using `ssh … 'cat > …'` per file. Verify:
  - media encodes;
  - `pkg-10-2-26` (or a fresh real draft for that date) moves to awaiting review;
  - the player plays the MP3 and "Jump to hour 2" lands at hour 1's measured length.
- [ ] **Step 4: Connect Mixcloud** from Settings. Verify "Connected as …" and that the token file exists with mode 640 and the right owner.
- [ ] **Step 5: Spike V5, the unlisted test.**
  - A one-off `apps/publisher` CLI flag `--unlisted-test <packageId>` uploads the prepared MP3 with `unlisted=true`, outside the queue. It never calls claim or result.
  - Tarik checks on Mixcloud that the title, tags, description, cover and **tracklist sections without times** all display. Record the result in `docs/SPIKES.md` (V5/V6).
  - Tarik deletes the unlisted show on Mixcloud.
  - **Stop rule:** if sections without times do not display, stop and ask Tarik. The spec's fallback is an artist list in the description, and that changes `toMixcloudFields`.
- [ ] **Step 6: The first real publish.** Tarik presses Approve on his phone. Verify:
  - the Telegram ready card arrived earlier;
  - `publishing` then `succeeded`, with a receipt link to the public show;
  - the MP3 and inbox folder are deleted;
  - the timeline row is written.
- [ ] **Step 7: Reboot test.** Announce it: about 1 minute down. All services return, and no package is stuck in `publishing`.
- [ ] **Step 8: Docs.**
  - `DEPLOY.md`: media, publisher, inbox copy command, Mixcloud connect, permissions, troubleshooting `outcome_unknown` and `needs_reconnect`.
  - `ARCHITECTURE.md` 3.4/3.5 updated to what was built.
  - `docs/SPIKES.md`.
  - `docs/FRICTION_LOG.md`.
  - The README "what changed" note on ffmpeg-on-VM instead of serverless.
  - `docs/LEARNING-LOG.md` entry with "In my words" left blank.
  - Commit.
