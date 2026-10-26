# Build plan

Deadline: **Oct 30, 2026, 12:00 CDT**. Day 1 is Oct 19. Aim to submit the morning of Oct 30 at the latest, with Oct 29 as buffer.

Priorities come from `docs/PRD.md` section 6. P0 is never cut. If behind, cut in this order: bulk backlog, Bandcamp page fetch, release radar, pre-air verify, then show planning (keep theme ideas, drop deep-dive polish first). Show planning is P1 because it is how Tarik works every week.

## Day 1: scaffold and verification spikes

First provision the Nebius AI Cloud Linux VM by following `docs/NEBIUS_SETUP.md` (install the `nebius` CLI, create a federation profile, create a CPU-only Ubuntu VM with 100 GiB disk, install Docker and Compose). Only 443 is open to the world; SSH is limited to Tarik's IP or a tunnel. Confirm the Nebius account has billing or credits before anything else. Create the Token Factory API key separately; it is not the CLI profile. Everything below is built to run there with Docker Compose.

Create the repo (MIT or Apache-2.0 license, README skeleton, this `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`, `docs/`, `skills/`, `fixtures/`). Run the Impeccable design skill against `PRODUCT.md` and `DESIGN.md`. Then run these spikes, each with a hard time limit (about 45 minutes), and record the result in `docs/SPIKES.md`.

| # | Spike | Pass | If it fails |
|---|---|---|---|
| V1 | Install NemoClaw with Hermes on a Nebius Linux VM (`curl -fsSL https://www.nvidia.com/nemoclaw.sh \| NEMOCLAW_AGENT=hermes NEMOCLAW_SANDBOX_NAME=airc bash`; Docker; no GPU needed). **Set `TELEGRAM_BOT_TOKEN` before the first sandbox build** so Telegram is in the image | Agent runs in the sandbox, unapproved hosts are blocked and shown, `nemohermes airc status` is healthy, activity log readable, shell/bash available to the agent (not documented; confirm) | Plain OpenShell + Hermes without NemoClaw; note in feedback |
| V2 | Nemotron on Token Factory: list available models, then register it as a custom provider (`NEMOCLAW_PROVIDER=custom`, `COMPATIBLE_API_KEY`, Token Factory base URL) | Chat completion works from inside the sandbox through `inference.local` | Use the largest available Nemotron; record limits |
| V2b | Reach the Hermes API (port 8642) from the console backend over loopback or through the authenticated reverse proxy | Console can send a task and stream a reply | Use Telegram as the only control channel and make the console read-only state plus approvals |
| V3 | Nemotron writes valid OpenUI Lang (use the prompt pattern in crate-web `src/lib/openui-prompt.ts`) | 9 of 10 PackageCard generations validate | Constrain the output to JSON that the app maps to components; keep OpenUI for the chat renderer only |
| V4 | Hermes calls an MCP server; point it at Crate's `src/mcp-server.ts` | `musicbrainz_*` tool call returns data | Wrap the needed Crate clients in a small Air Check MCP server |
| V5 | Mixcloud `unlisted` upload of a short MP3 with 3 `sections` (artist and song, **no** `start_time`) and 5 tags | Upload succeeds and sections display | Fall back to a short artist list in the description (Tarik does not use start times) |
| V6 | Mixcloud account is Pro? Does `publish_date` accept a past date on an unlisted upload? | Backdating works | Upload oldest first; note the limitation |
| V9 | Bandcamp Subsonic: enable in Fan Settings, list the collection from the ingest worker, compare the count to the Bandcamp collection page, time a full sync, and play one proxied stream with a seek in a browser (see `docs/BANDCAMP_COLLECTION.md`) | Count within a few percent, artist, album and track titles present | Skip ownership tags; keep the email radar |
| V7 | Convex read-only query for `plays` (`by_station_played_at`) for `88nine` and `hyfin` | Returns rows; `rhythmlab` is rejected by the tool | Seed a small fixture for the demo |

## Days 2 to 11

| Day | Date | Build | Done when |
|---|---|---|---|
| 2 | Oct 20 | Console shell: Clerk (@radiomilwaukee.org) + demo login, sidebar, header, Today / Chat / Episodes views with seeded data. Convex schema (`shows`, `packages`, `tracklists`, `verifications`, `releases`, `digests`, `audit`) | Mock screens work with seeded data; demo mode cannot publish |
| 3 | Oct 21 | Tracklist entry: parser (adapt rhythm-lab-app `playlist-parser.ts`), closing-track marking, bad-line flags, MusicBrainz spelling check. Plan-ahead flow: draft, editable while voice-tracking, final after recording. No times | Unit tests pass; 10-2-26 parses to 15 + 16 tracks; only final lists trigger a package |
| 4 | Oct 22 | Ingest worker: Box listing and the `rlr-box-episode-assembly` rules; Drive and Paper export for the 2026 backlog; reconciliation | Episodes view shows real status for all 2026 shows (29 ready, 2 no notes, 4 no audio, 7 blank Fridays) |
| 5 | Oct 23 | Agent with skills in the sandbox; package draft from the golden fixture inputs; OpenUI PackageCard; approval card; preview panel | Generated package matches `fixtures/RLR-10-2-26-mixcloud-package.md` |
| 6 | Oct 24 | Publisher: OAuth (adapt rhythm-lab-app), server-side upload, metadata validation, retry on 403 `Retry-After`. Media worker: join and encode MP3 | Unlisted end-to-end upload of 10-2-26 |
| 7 | Oct 25 | **Plan view:** `tracklists` history table and code-computed stats (`theme_stats`), theme ideas (`rlr-theme-ideas`), ThemeCard, pick seeds a draft, deep dives (`rlr-deep-dive`) through Crate and Tavily, DeepDiveCard | Theme cards cite real past shows; a deep dive has sources; closing tracks are skipped |
| 8 | Oct 26 | AgentMail inbox, webhook, extractor (no tools), `releases`, Bandcamp auto-forward, release radar view; radar and digest feed theme ideas | Injection test passes; Bandcamp emails appear organized by label and date; a radar release shows up as a candidate in a theme |
| 9 | Oct 27 | Show notes (`rlr-show-notes`, `generate_show_notes`, ShowNotes card, Markdown export; compare against one real Paper notes doc) and pre-air verify (claim extraction, Tavily + Crate, ClaimReport card, Telegram delivery; reuses the deep-dive source checks). Morning digest (cron + Telegram + Today view) | Cited report for the next show's notes; digest arrives on Telegram |
| 10 | Oct 28 | Audit log view from OpenShell, learning diff UI (skill update after an edit or a theme pick). Publish one real show publicly after approval. Demo workspace polish | Blocked request shows in audit; real show live on Mixcloud |
| 11 | Oct 29 | Record the video (script in PRD 5a), README, feedback write-up, "what changed" note, fixes. Submit the morning of Oct 30 at the latest | Video under 3 minutes; public repo and demo URL live; submission form ready |
| Submit | Oct 30 | Submit before 12:00 CDT | |

## Submission checklist

- Runs on Nebius Token Factory or AI Cloud, with at least one NVIDIA Nemotron model.
- Public repo with a visible OSI license; README with setup, and how NVIDIA models, Token Factory and other Nebius tools are used.
- Hosted demo URL (demo workspace, sample data, publishing off).
- Public YouTube video, 3 minutes or less.
- Feedback on Token Factory, AI Cloud and NVIDIA tools (keep `docs/FRICTION_LOG.md` from Day 1).
- Written note on what is pre-existing and what changed (draft in `docs/ARCHITECTURE.md` section 3.9).
- Project description: what, why, how.

## First prompts for Claude Code

1. "Read README.md, CLAUDE.md, docs/PRD.md, docs/ARCHITECTURE.md and docs/NEBIUS_SETUP.md. Summarize the plan in 10 lines and list what you would ask Tarik before starting."
2. "Scaffold the repo per BUILD_PLAN Day 1: license, README skeleton, folder layout (apps/console, services/ingest, services/media, services/publisher, agent/, convex/, docs/, skills/), and docs/SPIKES.md and docs/FRICTION_LOG.md."
3. "Run the Impeccable design skill on PRODUCT.md and DESIGN.md, then build the console shell from design/mockups using DESIGN.md tokens."
4. "Implement the tracklist parser with tests, starting from reference/REUSE.md's rhythm-lab-app pointer. Add closing-track marking and the golden 10-2-26 test."
6. "Build show notes per docs/ARCHITECTURE.md section 3.11 and skills/rlr-show-notes. Reuse the deep-dive source checks. Citations are enforced in code. Read fixtures/show-notes-format.md for the target format."
5. "Build the Plan view per docs/ARCHITECTURE.md section 3.10 and skills/rlr-theme-ideas and rlr-deep-dive. Compute history stats in code; the model only writes the theme cards and briefs."
