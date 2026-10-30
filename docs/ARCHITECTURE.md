# Air Check: architecture (draft v0.1)

A private, always-on producer for Rhythm Lab Radio and Radio Milwaukee. It prepares each week's show, checks the facts before air, and turns finished episodes into Mixcloud-ready packages, all with the station's data under the station's control.

Hackathon: Nebius x NVIDIA Global AI Hackathon, Personal AI Track. Deadline Oct 30, 2026, 10:00 PDT (12:00 CDT). Today is Oct 19, so roughly 11 days.

Items marked **(verify)** are things I have not been able to confirm from here and should be tested early.

---

## 1. What it does

> **Superseded** by `docs/PRD.md` sections 5 and 5a and `docs/superpowers/specs/2026-10-26-air-check-design.md`. Kept for history.

| # | Job | Trigger | Output |
|---|---|---|---|
| A | **New episode package** | A new dated folder with both hours appears in Box | Draft Mixcloud package (title, tags, description, tracklist, joined audio) sent to Telegram for approval |
| B | **Backlog catch-up** | On demand, or nightly until empty | The same package for each unposted show, 2026 forward, one at a time |
| C | **Pre-air verify** | Thursday and Friday before air, or on demand | Fact-check report for the Paper show notes with cited corrections |
| D | **Weekly adds brief** | Weekly | Rotation context for 88Nine and HYFIN from Convex play history (last played, 90-day plays, gaps) |
| E | **Learning** | Whenever Tarik edits or approves | Updates to skills and memory (title style, tag choices, naming patterns) |

Jobs A, B, and C are the demo. D shows the station-data angle. E is what makes it "personal".

## 2. Data map

| Data | Where it lives | How the agent gets it |
|---|---|---|
| Weekly show audio, 2 x ~1 hr WAV per episode | Box `Rhythm Lab Radio / Full Episodes 2023-2026` | Ingest worker only |
| Final tracklists | Google Drive, one doc per show | Ingest worker exports to markdown |
| Show notes | Dropbox Paper (about 33 docs in 2026) | Ingest worker exports to markdown |
| Station play history | Convex (rm-playlist-v2), stations `88nine` and `hyfin` | Read-only query endpoint |
| Already-posted shows | Mixcloud public API (`rhythmlab`) | Read-only, sandbox allow-listed |
| Web facts | Tavily | Sandbox allow-listed |
| Music metadata (release dates, credits, labels) | MusicBrainz, Discogs, Genius, Last.fm, Bandcamp | Through the Crate research service over MCP (section 3.9) |

Important data rules:
- The Convex station `rhythmlab` is the 24/7 stream, **not** the weekly show. It is never queried.
- Scope is 2026-01-01 forward, plus any 2025 Friday Tarik adds on Episodes (decision 018; the console warns when Mixcloud already has a show for that date). As of today: 35 shows have a Drive tracklist, 31 have Box audio, 29 have audio, tracklist and Paper notes.
- Mixcloud's newest posted cloudcast is the 10.24.25 episode (posted Nov 12, 2025), so the backlog is about 35 to 40 shows. Confirm against the live account.

## 3. Components

```
 Tarik (Telegram, dashboard)
        |
        v
+-------------------------------+        +-----------------------------+
| NemoClaw / OpenShell sandbox  |        | Ingest worker               |
|  Hermes agent                 |        |  holds Box / Drive / Dropbox|
|   - MEMORY.md, USER.md        | <----- |  credentials                |
|   - skills/*.md               |  corpus|  exports to markdown + JSON |
|   - cron                      |  (files|  watches Box for new folders|
|   - MCP tools (below)         |  only) +-----------------------------+
|  default-deny egress          |
|  audit log                    |        +-----------------------------+
+---------------+---------------+        | Media worker (GPU, Nebius)  |
                |                        |  ffmpeg join + encode       |
                | MCP tools              |  Crate research (MCP)       |
                v                        +-----------------------------+
   corpus.search      (local files)
   plays.query        (Convex, read-only, 88nine + hyfin)
   mixcloud.list      (Mixcloud API, read-only)
   web.search         (Tavily)
   package.submit  ----> approval queue ----> Publisher (holds Mixcloud OAuth)
```

### 3.0 Hosting (decided Oct 19, 2026)

**Everything Air Check runs, it runs on Nebius.** Hackathon rule: projects must run on Nebius Token Factory or Nebius AI Cloud. The Hetzner VPS is not used for the submission; it is the planned long-term home after Oct 30.

| Piece | Where | Notes |
|---|---|---|
| Models (Nemotron) | Nebius Token Factory | Registered in NemoClaw as a custom OpenAI-compatible provider |
| Agent: Hermes in the OpenShell sandbox (NemoClaw) | One Nebius AI Cloud Linux VM, Docker | No GPU needed with hosted inference. Dashboard (18789) and API (8642) stay on loopback |
| Console (Next.js) and reverse proxy | Same VM | HTTPS, Clerk sign-in, is the only public entry and the public demo URL. The AgentMail webhook also enters here |
| Ingest worker, publisher | Same VM. The publisher is built as a host process under systemd (`aircheck-publisher.service`, decision 014), not a container | Hold the source and Mixcloud credentials. Secrets in separate env files, never mounted into the sandbox. A second VM would separate them more strongly if time allows |
| Crate research service (behind the bridge) | Same VM, a host process under systemd (not a container), on the private address only | The host firewall (ufw) protects host ports, but ports published by Docker skip ufw. A host process bound to the private address with one ufw rule (allow only the `openshell-docker` network) keeps it off the internet. Runbook: `docs/DEPLOY.md` |
| Relay (console to Hermes) | Same VM, a host process under systemd (`aircheck-relay.service`), not a container | The only program that talks to Hermes. The console never calls Hermes directly, because Hermes stays on loopback (decision 012). The console writes queued runs into Convex. The relay watches Convex, starts Hermes runs at `127.0.0.1:8642`, streams events back and sends stops. It also reads the sandbox log into the Trust page. Runbook: `docs/DEPLOY.md` |
| Media worker (ffmpeg join and MP3 encode) | Same VM, a host process under systemd (`aircheck-media.service`). The Serverless Job option was dropped on Oct 27 (decision 014) | Plan about 3 GB scratch for one show in flight (two WAVs are about 1.26 GB); process one show at a time and delete after upload |
| State and auth | Convex Cloud and Clerk (hosted services, as in TarikOS) | Not on Nebius. Disclose in the README: compute and models run on Nebius; auth and the app database are hosted services |
| External services | Telegram, Tavily, AgentMail, Mixcloud, Box / Google / Dropbox | Only the ones on the sandbox allow-list are reachable from the agent |

Deployment is Docker Compose, so moving to Hetzner later is a copy-and-configure job. **(verify)** Tarik's Nebius account can create the VM and has credits or billing set up; VM size is chosen on Day 1. Step-by-step CLI setup is in `NEBIUS_SETUP.md`.

### 3.1 Agent: Hermes inside OpenShell, installed via NemoClaw
- Harness: Hermes Agent. It provides persistent memory (MEMORY.md, USER.md), SKILL.md files, cron, a Telegram gateway, and MCP support.
- **NemoClaw facts (from NVIDIA's NemoClaw + Hermes quickstart and architecture pages, Oct 19):**
  - Install: `curl -fsSL https://www.nvidia.com/nemoclaw.sh | NEMOCLAW_AGENT=hermes NEMOCLAW_SANDBOX_NAME=<name> bash`, then `nemohermes <name> status`. Docker is the default runtime (rootless Podman optional). Linux and macOS supported. No GPU needed when using hosted inference.
  - Inference: a custom OpenAI-compatible provider is supported (`NEMOCLAW_PROVIDER=custom`, `COMPATIBLE_API_KEY`), which should work for Nebius Token Factory. **(verify.)** Provider credentials stay outside the sandbox; the agent holds a placeholder that OpenShell swaps in at the approved egress point.
  - Network: OpenShell blocks unapproved hosts, surfaces them for operator approval, and rules hot-reload. Approvals last for the current sandbox only. System paths are read-only; `/sandbox` and `/tmp` are writable.
  - Telegram: needs `TELEGRAM_BOT_TOKEN`, and the docs advise configuring messaging **before the first sandbox build** so the image includes it.
  - Ports: dashboard 18789 and API 8642 bind to loopback by default. Reach them by SSH forwarding, or put a reverse proxy in front (set `CHAT_UI_URL` to its HTTPS origin before onboarding) and protect that ingress. The Air Check console would sit in front as the authenticated reverse proxy. **(verify the 8642 API supports the chat/task calls the console needs.)**
  - Not documented on the pages read: how the agent gets shell/bash access inside the sandbox, and the format of the activity log (a "Monitor Sandbox Activity" page exists). **(verify; the audit-log view depends on it.)**
- Sandbox: OpenShell with a default-deny network policy. Egress allow-list only: the Nebius inference endpoint, the Convex query endpoint, `api.mixcloud.com`, Telegram, and the bridge on the VM's private address (decision 006). Nothing else. Tavily is not on the list: since Plan 7 web search goes only through the bridge's `source_search`, which holds the key, so code sees every result (decision 019). The sandbox is rebuilt without its own Tavily key (`deploy/hermes/reonboard-without-tavily.sh`), which also closes the `/extract` page-reading gap in decision 006's addendum.
- The agent has **no** Box, Drive, Dropbox, or Mixcloud-write credentials. It sees files the ingest worker puts in its corpus folder and the read-only tools above.
- Audit log: every network request and tool call is shown on the dashboard. This is the privacy evidence for judges.

### 3.2 Models (Nebius Token Factory, NVIDIA open models)
- **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b` on Token Factory) for everything a model does: drafting, the radar's email extraction, and research (show notes, pre-air verify, deep dives).
- **Nemotron Nano is not used** (Tarik, Oct 29). Spike V3 measured it less exact: 9/10 valid and 7/10 exact, against Super's 10/10 and 10/10. Research is only worth having if it is exact, so there is no Nano step.
- **Speech-to-text and track timing: not needed.** Tarik decided on Oct 19 that sections carry no start times, so no ASR model is required.
- Hackathon rule: must run on Token Factory or AI Cloud, with at least one NVIDIA open model. Both are satisfied by the first two bullets.

### 3.3 Ingest worker (separate process, holds credentials)
- Polls the Rhythm Lab folder in Box for new dated subfolders.
- Exports Drive tracklists and Paper notes to markdown plus a small JSON record per show.
- Runs the `rlr-box-episode-assembly` and `rlr-source-reconciliation` logic as code for the deterministic part, and asks the agent only for judgment calls.
- Writes to the agent's corpus folder. No credentials ever enter the sandbox.

### 3.4 Media worker (built: a host service on the VM, decision 014)
- Built as `apps/media`, a host systemd service (`aircheck-media`) on the VM, using ffmpeg installed on the VM. Decision 004's Nebius Serverless Job was dropped on Oct 27 (Tarik's call).
- Audio arrives in an inbox folder on the VM, one `YYYY-MM-DD` folder per show with the two hour WAVs. Copies land under a temporary `.part` name and are renamed when complete.
- A WAV is used only when its header says the whole file is there (the RIFF size field matches the size on disk) and nothing has written to it for 2 minutes. ffmpeg turns a cut-off WAV into a short MP3 without complaint, so this guard keeps a half-copied show from being approved.
- Joins the two hours in order and encodes a 192 kbps MP3 for Mixcloud (the upload API documents only the `mp3` field). At most 3 prepared MP3s wait on disk (`MAX_PREPARED`); after a failure a show waits 10 minutes before the next try.
- Measures real durations (never assumes 60:00). The hour-1 length drives the player's "Jump to hour 2" (design spec 5.8).
- Talks to Convex with its own `MEDIA_TOKEN`, which can only list packages waiting for audio, attach the MP3's hash, report waiting shows and list MP3s it may delete. When it attaches the MP3, the real WAV filenames replace the agent's placeholder hour ids. It cannot approve anything.
- The MP3 and the inbox folder are deleted after the show is on Mixcloud.
- No track start times are generated or sent.
- First real show (10-2-26, Oct 28): 99 seconds to encode, 171.6 MB, 7150.08 seconds.

### 3.5 Publisher (approval-gated, holds Mixcloud OAuth)
- Accepts only a package that Tarik approved in the signed-in console (design spec 5.1 and 7.1). Telegram never approves.
- Uploads through Mixcloud's upload API (checked against the Mixcloud developer docs, Oct 19): `POST https://api.mixcloud.com/upload/`, multipart, OAuth 2.0 access token. Fields: `mp3` (audio, 4 GB max), `name` (required), `description` (**max 1,000 characters**), `tags-0-tag` to `tags-4-tag` (5 max), `picture` (10 MB max), `unlisted`, and `sections-N-artist` / `sections-N-song` / `sections-N-start_time` (whole seconds).
- Authorization is browser-based only: Tarik signs in once from the console's Settings page ("Connect Mixcloud"); the console's server writes the token to a file on the VM that only the publisher reads. Convex holds only whether Mixcloud is connected. Tarik can revoke it at any time.
- `publish_date` is **Pro only**, and the docs say it applies to shows never made public. Whether a past date works for backdating is unverified. Without it, shows post with today's date, so upload the backlog oldest first to keep the feed order right.
- **Tracklist:** the description limit means the tracklist goes in `sections`, with artist and song only (no times). Answered by the first live post (10-2-26, Oct 28): Mixcloud accepts sections without times and shows them like Tarik's manual posts (spike V5 in `docs/SPIKES.md`). Mixcloud's public API returns no sections for any show, so check the show page, not the API.
- Built as `apps/publisher`, a host systemd service (`aircheck-publisher`) with its own `PUBLISHER_TOKEN`, which can only read the approved queue, claim one package, record the result and report the Mixcloud connection.
  - **Pacing:** at most 3 uploads per America/Chicago day, oldest show first. Unknown outcomes count toward the 3.
  - **Checks before sending:** the MP3 is re-hashed against the approved fingerprint (`audio_changed` / `audio_missing` if not), metadata is validated and the cover fetched before the package is claimed, and the MP3 is streamed from disk.
  - **Never retry an unknown outcome.** A crash, timeout, 5xx or unreadable answer leaves the package `outcome_unknown`. On start, any package left `publishing` becomes `outcome_unknown`, never approved. Tarik checks Mixcloud, then confirms ("It's on Mixcloud" with the show's address) or reopens it for review.
  - A rate limit (HTTP 403 with `Retry-After`) is waited out and retried once. A refused access token is the one case that puts a package back to `approved` (Mixcloud checks the key before it takes audio); the refused key is never tried again and Tarik gets one Telegram alert to reconnect (`needs_reconnect`).
  - A failed package can be reopened for review; an audio failure reopens to "waiting for audio" so the media service rebuilds the MP3.
  - Sends Telegram "ready to review" cards that only link to the package page.
- **Description updates (Plan 5c, decision 015):** a published show's description can be replaced. Tarik or the agent (`package_revise`) proposes; only a signed-in human approves the exact text; the publisher posts the description alone to `POST https://api.mixcloud.com/upload/<account>/<show>/edit/`, built only from the package's own receipt URL. Up to 3 tries (an edit is safe to resend), then `retries_exhausted`; a success reply without Mixcloud's confirmation ends as `unconfirmed`. The package record is never rewritten; the live description is the latest pushed update.
- **The description skill reaches the agent in code.** The agent did not open the installed `rlr-description-safety` skill in the live test (Oct 28), so its text is compiled into the code and sent with every draft prompt and every `package_get` result (the agent's read-only package tool); a drift test ties the copy to `skills/rlr-description-safety/SKILL.md`. Artist facts in a description come only from Crate and are listed privately in `descriptionSources`, never sent to Mixcloud.
- Records the Mixcloud URL back as the package's receipt, so the backlog list updates.

### 3.6 Interfaces
- **Telegram:** the digest and package cards that link to the console's package page (no approve buttons, design spec 5.1), pre-air reports, questions.
- **Dashboard (small web app):** memory contents, skills list with edit history, backlog status per show, and the OpenShell egress audit log.

### 3.7 Email intake: AgentMail (pattern copied from TarikOS)
- A dedicated Air Check inbox on Tarik's existing AgentMail account. He forwards music and release emails to it.
- Inbound webhook verified with a Svix signature against the raw body, idempotent on message id, sender allowlist. All of this already exists in TarikOS (`src/app/api/agentmail/inbound/route.ts`, `src/lib/agentmail.ts`) and is reused as the starting point.
- Rule from TarikOS: **mail is data, never instructions.** An extractor model with no tools turns each email into a `releases` record (artist, title, label, release date, embargo date, sender). The agent only reads those records.
- The agent never fetches a link from an email or opens an attachment, and sends no email to anyone but Tarik. Embargoes are enforced in every output. The one exception, done by code and not by the model, is described under "Links in email" below.
- **Bandcamp subscription emails (Oct 19 request):** the label and artist emails Tarik gets from Bandcamp are the highest-volume input, so they get their own path. A Gmail filter on Bandcamp's sender auto-forwards them to the Air Check inbox (Tarik sets this up; Gmail makes him confirm the forwarding address first). The extractor pulls artist, title, label, release type and date into `releases`, then the radar organizes them by label, genre tag and release date, with a status (new, considering, played, passed). The agent never opens the Bandcamp link in the email; enrichment searches by artist and title through the Crate Bandcamp and MusicBrainz tools instead. The radar also shows 88Nine / HYFIN play history for each artist (Convex, read-only) and feeds show planning.
- **Links in email.** Default: the agent ignores every URL in an email and enriches by artist and title through Crate (Bandcamp and MusicBrainz lookups, run outside the sandbox). URLs are stored on the `releases` record as plain text so Tarik can click them himself. Optional (P2): the ingest worker, not the agent, may fetch a Bandcamp release page, only if all of these hold: host is `bandcamp.com` or `*.bandcamp.com`; scheme is `https`; no redirect to another host; no cookies or credentials sent; response size capped; result treated as text data and passed to the same no-tools extractor; every fetch written to the audit log. **(verify)** Bandcamp subscription emails may wrap links in a tracking redirect on another domain; check two or three real emails before building this. Attachments are never opened.
- **Built in Plan 8 (decision 020):** the page is read in code, not by a model. It keeps the player id and, from the same request (Task 6b), the cover art's address on `*.bcbits.com`, up to 12 checked tags and the album description as plain text with links removed. It also reads the release date (JSON-LD `datePublished`, else the visible "released ..." line), which fills `releasedOn` only when the release has none and Tarik has not edited it. The description is display-only and never reaches the agent; the tags may (`radar_get`).
- **Roundups (decision 024, Oct 30).** An email that names several releases (a co-sign roundup, a label newsletter) makes one record per release, up to 12; each release is checked against the email on its own. A one-release email takes the email's first Bandcamp page; in a roundup a release takes only the page whose address ends in its own title's slug (`/album/salt-light` for "Salt & Light"), never another release's. Finding a Bandcamp page by artist and title on bandcamp.com's search was planned and is not built: the search answers the worker with a bot check, and since Oct 30 Bandcamp challenges the VM's album-page reads too. We do not work around it, so a release may get no automatic player; a manual paste of Bandcamp's embed code is offered separately (decision 024).

### 3.7a Morning digest
- A Hermes cron task runs about 6:30 am. It reads state only (Convex `packages`, the research jobs and their entries (`research`, `researchEntries`), `releases`, and the OpenShell audit log) and writes one digest record plus one Telegram message. It makes no network calls beyond Telegram and the store.
- Contents: packages ready to approve, new Bandcamp releases (count, labels, 88Nine / HYFIN play history), verification claims with status `conflict` or `could-not-verify`, and blocked requests since 6:00 pm the day before.
- The console's default screen is the same digest ("While you were away"), so Telegram and the web show one source.
- Skipped when nothing changed. Items link to the package, verify report, radar entry or audit row.

### 3.8 Frontend: the Air Check console
- Next.js + Tailwind, Clerk sign-in restricted to @radiomilwaukee.org (same pattern as TarikOS and the playlist app). Convex for app state.
- Chat-first layout: conversations, episodes (backlog), release radar, show plan, skills and memory, trust and audit.
- **Generated UI with OpenUI** (`@openuidev/react-lang`, MIT). The agent's replies stream as UI built only from a registered component library: `PackageCard`, `TagRow`, `StatRow`, `FlagList`, `TracklistTable`, `ReleaseCard`, `ShowPlanBoard`, `ClaimReport`, `ApprovalBar`.
  - Model calls go straight to Nebius Token Factory (OpenAI-compatible). The hosted OpenUI Cloud gateway is **not** used, because it would route station data through a third party.
  - Without the gateway there is no auto-correction, so the app validates the streamed output against the component schemas and falls back to plain text on failure. **(verify on day one: how reliably Nemotron writes valid OpenUI Lang.)**
  - Action buttons (Approve, Edit, Skip) call app endpoints with a package id and the signed-in user's session. The model can render a button but cannot trigger an approval.
- **Tracklist entry (Oct 19 decision):** for new shows Tarik types or pastes the playlist in the console instead of a Google Doc (he is the only user of those docs, so no export is needed). Lines are split in code (`Artist - "Title"`), the last good track of each hour is auto-marked `closing-track`, unparseable lines are flagged, and spellings are checked via MusicBrainz (Crate). Workflow: Tarik plans the show and types a draft before recording, edits it while voice-tracking (the order can change), and marks it final after the show is recorded; only a final list triggers the package. No per-track times are stored. The 2026 backlog stays in Drive and is read once by the ingest worker. Paper show notes are unchanged.
- Demo mode for judges: sample data, publishing switched off, a judge login that opens straight into it.
- Clickable mock: Artifact "Air Check Console Mock".

### 3.9 Reused from Crate and the Rhythm Lab web app, and what is new

Crate (crate-cli and crate-web) is Tarik's existing music research agent. Air Check **calls it, it does not copy it**, so the hackathon repo stays new work with a clear "what changed" note.

| Piece | Source | How Air Check uses it | Status |
|---|---|---|---|
| Data-source clients: MusicBrainz, Discogs, Genius, Last.fm, Wikipedia, Bandcamp | crate-cli `src/servers/*` | Called over MCP. These hold the rate limiting, parsing and API quirks that are slow to rebuild | Reused |
| MCP server (`crate-music-research`) | crate-cli `src/mcp-server.ts` | Run as a **separate research service outside the sandbox**. The agent's allow-list gets one new host instead of a dozen | Reused |
| OpenUI component library, stream adapter, prompt pattern | crate-web `src/lib/openui/`, `openui-prompt.ts` | Starting pattern for the console. Air Check registers its own components (PackageCard, FlagList, ReleaseCard and so on) | Pattern reused, components new |
| Clerk + Convex + Next.js setup | crate-web, TarikOS | Same stack for the console | Reused pattern |
| Mixcloud OAuth flow: authorize with CSRF state, callback, token table, refresh-token handling | rhythm-lab-app `app/api/auth/mixcloud/*`, `lib/mixcloud/oauth.ts`, `supabase/migrations/*mixcloud_oauth*` | Pattern for the publisher's one-time authorization. Rewritten for Air Check, token kept server-side only | Pattern reused |
| Mixcloud upload field mapping: `mp3`, `name`, `description`, `tags-N-tag`, `sections-N-artist/song`, `picture` | rhythm-lab-app `lib/mixcloud/client-upload-v2.ts` | Same field names in the publisher. Rhythm Lab app uploads from the browser to dodge serverless size limits; Air Check uploads server-side from the publisher, so the token never reaches a browser | Pattern reused |
| Playlist parser: `HOUR n` markers, `Artist - Track` lines, per-line errors and warnings, `tracksToMixcloudFormat` | rhythm-lab-app `lib/playlist-parser.ts` | Starting point for `playlist.parse` and the Tracklist entry screen. Adds closing-track marking and spelling checks | Adapted |
| AI description generation, cover image helper, Sanity episode upsert after import | rhythm-lab-app `app/api/episodes/*`, `lib/mixcloud/cover-image.ts`, `lib/sanity/episodeHelpers.ts` | Not copied. Idea kept: after a successful post, optionally call the web app's import so the site's episode page appears | Optional hook (P2) |
| `artist-deep-dive`, `sample-archaeology`, `scene-mapping` workflows | crate-cli `src/skills/` | Source material for `rlr-pre-air-verify` and `rlr-show-planning` | Adapted |
| `show-prep` (talk breaks, social copy) | crate-cli | **Not used.** Air Check does no talk, scripts or posts | Skipped |
| `vinyl-valuation` | crate-cli | Not used | Skipped |

**License warning on the Rhythm Lab web app:** its LICENSE is Business Source License 1.1, which is not an OSI-approved open source license, and the hackathon requires one. Tarik owns the code and can license copies under MIT, but the Air Check repo should either (a) contain only code written fresh for it, borrowing patterns, or (b) copy specific files and state in the README that they are relicensed MIT by their author. Either way, disclose it in the "what changed" note.

**What this saves:** the Mixcloud authorization and field mapping were already working in production (the web app's "Upload New Show"), so the publisher is a smaller build than first planned.

**New, written during the hackathon (the part judges score):**
- `verify_release`: checks a release date, label or credit against at least two sources and returns structured `{claim, status, sources[]}`. Crate's tools return research text for a person to read; verification needs a result the agent can act on and cite.
- `enrich_release`: matches a forwarded email's release record to MusicBrainz and Bandcamp and fills gaps.
- `check_spelling`: validates artist and track spellings and diacritics as Tarik types the tracklist.
- `plays.query` (Convex, 88nine and hyfin only) and `playlist.parse`.
- All Air Check skills, the approval flow, the publisher, the ingest worker and the console.

**Why not rebuild the data clients?** Eleven days. The clients are the slow, already-debugged part (rate limits, Bandcamp page parsing, API keys). Rewriting them would spend days to arrive where Crate already is, and nothing in the judging rewards it. The improvement is the layer above them: verification, structured output and approval, which is new.

**Constraints on the reused tools:**
- Run Crate outside the sandbox. Do not allow-list Discogs, Genius, Bandcamp and the rest individually.
- Disable the Bandcamp browser fallback (`browser.ts`) and keep its rate limit. It scrapes pages, which is more visible in a public repo.
- Neither Crate repo has a LICENSE file. Calling over MCP does not need one. Copying any Crate code into the Air Check repo needs an MIT license added to Crate first, plus attribution.
- **(verify)** Crate's tools use the Claude Agent SDK `tool` helper but are served through the standard MCP SDK, so any MCP client should work. Test with the Hermes MCP client on day one.

**As built (Plan 7, ruling D7).** The bridge gives the agent only the keyless Crate families: MusicBrainz, Wikipedia, Bandcamp search (no tool that takes a page URL) and iTunes. Discogs, Genius and Last.fm never reach the agent as tools; their pages can arrive only as web results from `source_search`. The table above lists the clients Crate has, not what the agent gets. `verify_release` and `enrich_release` were not built as separate tools: the research engine in 3.10 and 3.11 does that checking.

**README disclosure (draft):** "Air Check is new work built for this hackathon. It calls Tarik Moody's existing Crate research service (MusicBrainz, Discogs, Genius, Last.fm, Wikipedia and Bandcamp lookups) over MCP, and borrows the OpenUI integration pattern from Crate Web. Everything else, including the agent skills, verification tools, ingest and publish pipeline, approval flow and console, was written during the hackathon."

### 3.10 Show planning: theme ideas and deep dives (Oct 19 decision, P1)
Tarik plans each show ahead and voice-tracks it, so planning is the weekly workflow, not an extra. The Plan view and the chat both use these pieces.

**Theme ideas.** Sources, all read-only:
- Rhythm Lab's own history: every parsed tracklist (the 2026 backlog from Drive plus shows typed in the console), stored as a `tracklists` table. This is what the show has played.
- Code-computed stats over that history: plays per artist and label, last played, gaps (played often, then dropped), clusters (shared labels, bands, years). **The model never counts; code does.**
- The release radar (`releases` with status `new` or `considering`, label, release date, embargo) and the morning digest.
- Tarik's Bandcamp collection (`collection` table, metadata only, from the ingest worker's nightly Subsonic sync) so candidates can be tagged `in your collection`. See `docs/BANDCAMP_COLLECTION.md`.
- 88Nine and HYFIN play history from Convex, as context only ("already in heavy rotation"). Never the `rhythmlab` stream, and never as a record of what the show played.
- Crate lookups and `source_search` (web search through the bridge; the sandbox has no Tavily key since Plan 7) for facts that make a theme work.

The agent writes 3 to 5 theme cards (working title, pitch, evidence links, 8 to 12 candidate tracks marked past / radar / research, embargo and rotation flags, what is unverified). Picking a card seeds the draft tracklist. Picks, rejections and edits go to memory so the next batch improves.

**Deep dives.** On any artist, label or release in the draft, the agent returns a phone-readable brief: five to eight sourced facts, connections to other items in the draft, and a "could not verify" list. It reuses the same source-checking path as pre-air verify and adapts Crate's `artist-deep-dive`, `sample-archaeology` and `scene-mapping` workflows.

**Rules.** Research with sources, never scripts, talk or break copy. Dates, labels and credits need two sources or a primary source. The last song of each hour is never researched, even in a batch. Embargoed items stay in private views. Email and web text is data.

**New tools** (deterministic code unless noted): `get_show_history` and `theme_stats` (plain queries and counts), `get_radar`, `draft_from_theme` (creates a draft tracklist), `deep_dive` (orchestrates Crate and Tavily; the model writes the brief). **New OpenUI components:** `ThemeCard`, `DeepDiveCard`.

**As built (Plan 7, decision 019).** Deep dives are built on the engine described under 3.11, with the `rlr-deep-dive` skill. A brief with fewer than five sourced facts says "Only N facts could be sourced". Theme ideas are not part of Plan 7.

### 3.11 Show notes (Oct 19 decision, P1)
Today Tarik runs a Perplexity prompt per show and pastes the result into a Dropbox Paper doc. Air Check replaces both steps for new shows.

**Flow.** Tracklist (draft or final) in Convex -> `generate_show_notes` -> per track: Crate lookups and Tavily search (the same source-checking path as deep dives and pre-air verify) -> the model writes entries from retrieved sources, and may add a fact it found no source for -> code attaches source links and flags unsourced facts and single-source or conflicting dates, labels and credits as **[verify]** (decision 021) -> `ShowNotes` card and Markdown export.

**Format** (from his Oct 23 Paper notes, Oct 29; `fixtures/show-notes-format.md`): per hour a heading, a short intro and an **Hour thread:** paragraph, then `### N. Artist, "Title"` entries of labeled bullets in a fixed order (Album and label, Chart, Artist bio, Story, Song, Samples and connections, Video, Fun fact, On-air angle), links in his short form `[[en.wikipedia](url)]` after each sentence, **[verify]** only on facts to check (a conflict also says "Sources disagree: <host> says X, <host> says Y."), a "What I could verify / What I couldn't verify" pair for a track with little found, and **Notes for Your Review** at the end with one bullet per track that has flags and why. The console card shows the same shape (core's `noteBullets` and `reviewNotes`).

**Storage.** Notes live in Convex as the source of truth for new shows. Export is "Copy for Paper" (Markdown with headings, bullets and links). Air Check does not write to Paper: the agent has no Dropbox credentials, and a worker write to Paper is uncertain and not needed. The backlog's old Paper notes stay read-only inputs for the ingest worker.

**Rules.** Same as 3.10: sources or `could-not-verify` (a fact with no source is kept and marked, decision 021), two sources for dates, labels and credits, closing tracks skipped, embargo private, no scripts. Notes Tarik supplies by hand are labeled unchecked and kept apart from sourced facts. Show notes are private and never copied into a Mixcloud description; the draft's notes take confirmed and sourced facts only.

**Tools.** `generate_show_notes` (orchestrates Crate and Tavily; model writes), `regenerate_track`, `export_show_notes` (code). **Component:** `ShowNotes`. **Skill:** `rlr-show-notes`.

**As built (Plan 7, decision 019): one engine for show notes, pre-air verify and deep dives.** The agent searches and judges; code checks, counts and writes the document.
- **Two agent tools on the bridge.** `source_search` searches the web through Tavily, or Apple's catalog with `source: "apple_music"` (release date, label, the ℗ line, UPC or ISRC; never audio or artwork). Convex checks the day's cap and the embargo list before any search leaves the bridge. `research_submit` saves one block (a track, an hour's intro or threads, a verify line, or the deep-dive brief) through one narrow Convex route that can write nothing else.
- **Tavily settings (Oct 29).** `search_depth: "advanced"`, `chunks_per_source: 3`, `include_raw_content: "text"`, five results, published dates on; `/search` only, never `/extract`. Credit note: advanced is 2 credits a search (basic is 1) and the page text costs nothing extra, so the caps below spend at most 200 credits a real day and 40 a demo day on pay-as-you-go. The bridge reads up to 2 MB of answer in 25 seconds and keeps each page's text, whitespace collapsed, to 8,000 characters. The agent sees only each result's chunks (up to 3,000 characters, about 12 KB a search, for speed and context); the ledger keeps chunks and page text to 8,000 characters so code can check a date or label the agent never saw. On a source longer than 2,000 characters a value counts only within 300 characters of the block's artist or title (a deep dive: its subject), so a discography or catalog page cannot confirm another record's date or label. The research route takes up to 4 MiB, so a block citing 40 such sources fits.
- **First searches run in code (Oct 29 prefetch).** A show-notes job's first web search per track (`Tell me about this artist and release <Artist> - "<Title>"`), and since Oct 30 a second (`<Artist> - "<Title>" interviews, reviews and samples`, same batch, returned together by `first_search`), is not left to the agent. When the relay starts a research run it calls the bridge (`POST /aircheck/prefetch` or `/aircheck-demo/prefetch`, `{ job }`, with that route's MCP token; not an agent tool), and the bridge asks Convex (`POST /agent/research-prefetch`, read-only; the job id now rides on the relay's pending rows) for the tracks still to research, closing and embargoed ones left out, and runs all their searches at once; if the relay's call failed, the agent's first `first_search` or `research_submit` for the job starts it. Searches run at most 5 in flight, 15 seconds each, retried only on a 429, a 5xx or a timeout (after 1, 2, 4 and 8 s, 5 attempts). Each search is counted and embargo-checked through `/agent/search-usage` like any `source_search`; a failed one is given back (`POST /agent/search-done`), so only successful searches count, and the Tavily credits each answer reports (`include_usage`) are added to the day's line in Settings. Each `first_search` call returns that track's results compactly (ids, titles, dates and chunks up to 1,200 characters a result, no URLs; about 8 KB at most), waiting only if its own search is still running. Because the model skipped the prefetched searches in a live run (Oct 29, 22:33), `research_submit` refuses a show-notes track key until `first_search` has returned that key's results in this job, unless its search failed, the cap ran out or the track is embargoed; intros, threads and closing tracks are never held. Answers are kept per job and query for 12 hours (a failed or capped one for 10 minutes), so a continuation or Resume does not search again. Results are canonicalized (no fragment, tracking parameters or trailing slash) and one page found for two tracks is one ledger source holding each chunk once. `source_search` stays for gaps, still at most 3 web searches a track counting the first. Logs carry counts, milliseconds and the credit total only. Decision 022.
- **The source ledger.** The bridge gives every result, from Crate or `source_search`, a short id (`S7k2q`) and keeps its address, site, title and text for 24 hours, in memory only (a bridge restart forgets them, and a run in progress searches again). The agent cites ids, never URLs, artists or titles; code fills those in. A source counts for a date, label or credit only if its own text shows that value. A MusicBrainz item's ledger text starts with fact lines code builds from its JSON (title, credited artists, date, label names and catalog numbers, each track's number, position and length), so a long release keeps them inside the 8,000-character cap and near the artist's name; a length matches in milliseconds, seconds, m:ss or words, within one second (Oct 29). Two independent publishers, or one primary source (label, artist, press release), make a fact confirmed; anything less is **[verify]**.
- **Tables.** `research` (one row per job: kind, show date or subject, its tracks or note lines, status, runs) and `researchEntries` (one row per block: the agent's text, its cited sources and each fact's status, plus Tarik's edits, private marks and supplied notes, which survive every agent save). `searchUsage` counts searches per workspace per Chicago day: 100 web searches real and 20 demo, 60 and 20 Apple Music lookups, shown in Settings with the day's Tavily credits once the bridge reports any.
- **Pre-air verify** runs by itself at 9 am Chicago time on Thursdays and Fridays for the next show and sends one Telegram line with counts and a link. On demand, a done show-notes page has a **Pre-air verify** button that checks those Air Check notes (`startVerify` with `from: "air-check"`) and opens the new check; the demo sample stays read-only. Play-history context comes only from 88Nine and HYFIN.
- **Regenerate and edits.** Regenerate may replace a block's edit only when Tarik confirmed it over an edit that existed at that moment; an edit he makes while the Regenerate runs is kept (the agent's save is refused). `retarget` (re-point a job at a changed tracklist) is server-only: it has no button yet. A done job that a retarget left with work still shows Resume.
- **Closing tracks** are refused by key ("Closing tracks are never researched."); the document shows `closing-track, no notes`.

**Risk.** Perplexity is a search-and-synthesis product; Nemotron over Crate and Tavily results must match its quality on sourcing. Mitigation: source-grounded generation, code-enforced citations, and a side-by-side check against one of his published notes docs on Day 9. Good fit for the Best Use of Tavily bonus.

### 3.12 Bandcamp collection (Oct 19 decision, P2 or P1-light)
Bandcamp's Subsonic API (open beta) exposes a fan's purchased collection. The ingest worker, which holds the credentials, syncs it nightly into a Convex `collection` table (artist, album, track, year, item id; label when present). Only metadata is stored. Audio is never downloaded or stored, but owned items may be streamed to the signed-in user through the console's server proxy (Hard Rule 13, design spec 5.8). Tracklist lines are matched in our own code with the `rlr-source-reconciliation` normalization, because no ID-based lookup was found and the supported endpoints are not documented. Fuzzy matches are shown for Tarik to confirm. Tools: `get_collection`, `check_owned` (read-only). Full findings, terms-of-use reading and quirks: `docs/BANDCAMP_COLLECTION.md`. Verified by spike V9.

**Persistent player (P2).** A fixed mini player in the console plays owned items (streaming only, through a server proxy that keeps the credentials out of the browser). Queue = the draft tracklist. One `<audio>` element at the app root so playback survives navigation. Feishin is a reference only: it is GPL-3.0, so no code is copied. Details in `docs/BANDCAMP_COLLECTION.md`.

## 4. Skills (portable, station-owned)

Stored in `skills/` and versioned in the repo:
- `rlr-box-episode-assembly`: which Box files are the hours, what to ignore, when to ask.
- `rlr-source-reconciliation`: Drive vs Paper vs Box rules.
- `rlr-mixcloud-title-and-tags`: title and tag style from the 100 most recent posts.
- `rlr-description-safety`: private notes to public description, with what to leave out. Nemotron does not reliably open installed skills on its own (live test, Oct 28), so this one is also delivered in code: its body (no frontmatter) is generated into `DESCRIPTION_SKILL_TEXT` by `pnpm sync:skills`, sent in every draft-package prompt and returned as `descriptionGuide` by the bridge's `package_get`. A test fails when the generated text and the SKILL.md differ.
- `rlr-pre-air-verify`: the fact-check loop.
- `rlr-show-notes`: sourced show notes in his Paper format, replacing the Perplexity prompt (written).
- `rlr-theme-ideas`: theme suggestions from show history, the release radar and the digest (written).
- `rlr-deep-dive`: sourced research briefs on artists, labels and releases (written).
- `rlr-show-planning` (to write): turning a chosen theme into a draft list, checked against 88Nine and HYFIN play history and the release radar.
- `rlr-embargo-rules` (to write): what may be mentioned and when.
- `rlr-email-extraction-safety` (to write): how forwarded emails become `releases` records, and what is ignored.

Skills the agent should *write for itself* during the demo (the learning loop):
- Naming patterns Tarik confirms.
- Title and tag choices he overrides.
- Later: `88nine-adds-criteria` from his accept and reject decisions on adds.

## 5. Security and privacy design

- **Credential separation.** Source-system credentials live in the ingest worker; Mixcloud write access lives in the publisher. The sandboxed agent holds neither.
- **Default-deny egress** with an explicit allow-list, plus an audit log shown in the demo.
- **Human approval** before any publish. The agent drafts; it cannot upload.
- **Read-only Convex access**, scoped to two stations.
- **Content filtering** in the description skill: no unverified claims, no time-relative language, no private details about artists.
- **Audio stays in the station's accounts and on the Nebius VM.** Audio is downloaded to the VM only for the join and encode, then deleted after upload. Auth and the app database use hosted services (Clerk, Convex), disclosed in the README.

## 6. Hackathon checklist

| Requirement | Plan |
|---|---|
| Runs on Nebius Token Factory or AI Cloud | Inference on Token Factory; media worker on AI Cloud VM |
| At least one NVIDIA open model | Nemotron (Nano, plus Ultra or Super) |
| Public repo with OSI license | New repo, Apache-2.0 or MIT |
| README | Architecture, setup, demo steps |
| Hosted demo URL | Console on the Nebius VM behind HTTPS, demo workspace with sample data and publishing off (section 3.0) |
| Public YouTube video, 3 minutes or less | Script below |
| Feedback write-up | Written during build, from real friction |
| "What changed" note for pre-existing work | Use a fresh repo; call Crate (and Backstory, MKE Field Guide if needed) as MCP services and describe them as such. See section 3.9 for the draft disclosure |

## 7. Demo script (3 minutes)

> **Superseded** by `docs/PRD.md` sections 5 and 5a and `docs/superpowers/specs/2026-10-26-air-check-design.md`. Kept for history.

1. **0:00 to 0:20.** "I host Rhythm Lab Radio. Mixcloud's last post is almost a year old." Show the backlog list.
2. **0:20 to 1:20.** Live: the 10-16 audio lands in Box (expected this week). The agent notices, matches the Drive tracklist and Paper notes, and sends a Telegram approval card with title, tags, description, tracklist, and flags.
3. **1:20 to 1:50.** Show a flag ("the notes and tracklist disagree on the last track") and Tarik's reply; the skill updates.
4. **1:50 to 2:20.** Pre-air verify: a cited corrections report for next week's notes, with play-history context from 88Nine and HYFIN.
5. **2:20 to 2:50.** Dashboard: memory, skills, and the audit log showing every allowed and blocked request.
6. **2:50 to 3:00.** Backlog counter ticking down; close.

## 8. Build plan to Oct 30 (about 11 days)

> **Superseded** by `docs/PRD.md` sections 5 and 5a and `docs/superpowers/specs/2026-10-26-air-check-design.md`. Kept for history.

| Days | Milestone |
|---|---|
| 1 to 2 (Oct 19 to 20) | Install NemoClaw, Hermes, OpenShell on a Nebius VM. Confirm Nemotron on Token Factory. Test one Convex read-only endpoint. Test Box listing from the ingest worker. |
| 3 to 4 | Ingest worker: Box watcher, Drive and Paper exports, reconciliation. Corpus for 2026 (35 shows). |
| 5 to 6 | Agent package flow end to end for 10-2-26 (metadata only). Telegram approval cards. |
| 7 to 8 | Media worker: join and encode one show. Mixcloud upload test on a private or test cloudcast. |
| 9 | Pre-air verify job and Convex context. Dashboard with audit log. |
| 10 | Record the demo around the real 10-16 episode. Write README and feedback. |
| 11 (Oct 29 to 30) | Buffer, polish, submit before 12:00 CDT on Oct 30. |

## 9. Risks and how to cut scope

| Risk | Mitigation |
|---|---|
| Mixcloud upload API limits (OAuth, backdating, sections) | Stage the package and show the upload against a test account; document the gap |
| NemoClaw or Hermes install friction | Keep Day 1 for this; fall back to the plain OpenShell sandbox with Hermes if NemoClaw blocks |
| 10-16 audio not in Box in time | Demo on 10-2-26; show 10-16 as the live trigger if it lands |
| Backlog is large | Demo three shows; the rest run unattended |
| Convex access policy | Read-only endpoint, two stations, reviewed before enabling |
| Weekly show vs 24/7 stream confusion | Hard rule in the plays tool: reject any `rhythmlab` station query |

## 10. Open questions for Tarik

1. Are the Paper show notes written by hand or AI-assisted? (Affects what the agent should learn from them.)
2. Which 2026 Fridays had no show: Jan 2, Jun 19, Jul 31, Aug 7, Aug 14, Sep 25, Oct 9?
3. Where are 2-13, 7-17, and 9-4 audio files, if they exist?
4. Is the Mixcloud account's newest post really 10.24.25?
5. Is a test Mixcloud account or a private upload available for the publisher demo?
6. Which AgentMail address should Air Check use (new inbox, or an existing one such as `triton-ingest@`)? Which senders do you forward from?
7. Does the console need other staff logins, or only yours plus a judge demo login?

Resolved: the last song of each hour is never talked about on air, so it has no show-notes entry. The agent includes it in the tracklist as a `closing-track` and does not flag or research it (Tarik, Oct 19).
