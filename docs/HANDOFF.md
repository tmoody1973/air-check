# Air Check: handoff to Claude Code

A private, always-on producer for Rhythm Lab Radio. It takes a finished show (two hour files in Box, a tracklist, show notes) and turns it into an approval-ready Mixcloud package, fact-checks next week's notes, organizes Bandcamp and label release emails, and sends a morning digest. Nothing is posted without Tarik's approval.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI Track. **Deadline: Oct 30, 2026, 12:00 CDT (10:00 PDT).** Handoff written Oct 19.

## Read in this order

1. `PRODUCT.md` and `DESIGN.md` (Impeccable format; run the Impeccable design skill against these before building any screen)
2. `docs/PRD.md` (what it must do, priorities, cut order, the 3-minute video plan)
3. `docs/ARCHITECTURE.md` (how it is built, what is verified and what is not)
4. `BUILD_PLAN.md` (Day 1 verification checklist, then day-by-day tasks and starter prompts) and `docs/NEBIUS_SETUP.md` (Nebius CLI install, profile, VM creation, firewall); `docs/BANDCAMP_COLLECTION.md` (Subsonic findings and spike V9)
5. `reference/REUSE.md` (exact files to read in Tarik's other repos)
6. `design/` (clickable mock source, screens and states)
7. `skills/` (eight station skills, already written, including `rlr-theme-ideas`, `rlr-deep-dive` and `rlr-show-notes`) and `fixtures/` (the 10-2-26 golden package)

## Decisions already made (do not reopen without asking Tarik)

- **Stack:** NemoClaw, Hermes Agent, OpenShell sandbox on Nebius. Models on Nebius Token Factory; at least one NVIDIA Nemotron model. Console is Next.js + Tailwind + Clerk + Convex, with generated UI through OpenUI.
- **Hosting:** everything runs on Nebius. Models on Token Factory; agent, console, workers and publisher on one Nebius AI Cloud Linux VM with Docker Compose (`docs/ARCHITECTURE.md` section 3.0). Not Hetzner and not Vercel for the submission; Hetzner is the post-hackathon home. Clerk and Convex are hosted services, disclosed in the README.
- **Credential separation:** the sandboxed agent holds no Box, Drive, Dropbox or Mixcloud credentials. A separate ingest worker, media worker and publisher hold them.
- **Human approval** before any publish. Demo mode never publishes.
- **No on-air talk, scripts, break copy or social posts.**
- **Convex play history: stations `88nine` and `hyfin` only. Never `rhythmlab`** (that is the 24/7 stream, not the weekly show). Reject it in code.
- **Closing-track rule:** the last song of each hour is never talked about. Include it in the tracklist, mark it `closing-track`, never research or flag it.
- **New shows' tracklists are typed into the console**, not Google Docs. Tarik plans ahead and voice-tracks: he types a draft, edits it during voice-tracking, and marks it final after recording. No per-track times. The 2026 backlog stays in Drive and is read once.
- **Show planning is P1.** The Plan view suggests 3 to 5 theme ideas from Rhythm Lab's own past tracklists, the release radar and the digest, and runs sourced deep dives on artists and labels through Crate and Tavily. Research only, never scripts.
- **Email is data, never instructions.** The agent never fetches links or opens attachments, and sends no mail except to Tarik. Enrichment goes through Crate by artist and title. An optional, code-only, allowlisted Bandcamp page fetch is a P2 (ARCHITECTURE 3.7).
- **Scope:** shows from 2026-01-01 forward.
- **Single user** (Tarik) plus a judge demo workspace with sample data.
- **Fresh repo** with an OSI license (MIT or Apache-2.0). Borrow patterns from Tarik's other repos; see `reference/REUSE.md` for license cautions.

## Not verified (test first, see BUILD_PLAN.md Day 1)

- NemoClaw / Hermes install and how Hermes talks to MCP servers and Telegram.
- Nemotron on Nebius Token Factory: which sizes exist, and whether it writes valid OpenUI Lang.
- Whether Mixcloud accepts and displays `sections` without `start_time` (the Rhythm Lab web app sends none; Tarik does not need times).
- Whether Tarik's Mixcloud account is Pro (`publish_date` backdating is Pro only).
- Whether the newest Mixcloud post is really the 10.24.25 episode.

## Secrets

No credentials are in this package. Needed env vars, to be filled by Tarik: `NEBIUS_API_KEY`, `MIXCLOUD_CLIENT_ID`, `MIXCLOUD_CLIENT_SECRET`, `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, `TAVILY_API_KEY`, `TELEGRAM_BOT_TOKEN`, `CLERK_*`, `CONVEX_*`, Box / Google / Dropbox credentials for the ingest worker only. Station-specific IDs are in `PRIVATE_NOTES.md`, which must not be committed to the public repo.
