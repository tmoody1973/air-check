# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences:

1. **Tarik Moody**, the daily user. Host of Rhythm Lab Radio for 20+ years and Director of Strategy and Innovation at Radio Milwaukee. Works in short sessions around a weekly show: type the tracklist, approve packages, check facts before air, glance at new releases. Reads on a phone in the morning (Telegram digest) and at a desk (console).
2. **Hackathon judges** (Nebius x NVIDIA, Personal AI Track), who open a demo workspace with sample data and watch a 3-minute video. They judge Technological Implementation, Design, Potential Impact and Quality of the Idea.

Single-user by design. No staff accounts.

## Product Purpose

Air Check is a private producer for a weekly radio show. It turns finished episodes into Mixcloud-ready packages, fact-checks show notes before air, organizes release emails (including Bandcamp label and artist subscriptions), and delivers a morning digest of what needs attention. The station's data stays under the station's control, and the interface proves it.

Success is all three:
- **The backlog clears.** About 35 shows from 2026 reach Mixcloud at the pace Tarik approves them.
- **Trust.** Tarik never worries about what the agent did: nothing publishes without his approval, and every request it made is readable.
- **A credible demo.** A judge understands the problem, sees it work, and sees the privacy model, in three minutes.

## Positioning

A producer's assistant, not a chatbot and not a dashboard. The chat is how you ask; the cards it returns are how you decide. Most agent products ask you to trust them. This one shows the sandbox, the audit log, the sources behind every field, and what it learned from your edits.

## Operating Context

- Surfaces: Today (digest), Chat, Episodes (2026 backlog), Tracklist entry, Release radar, Show plan, Skills and memory, Trust and audit. Package preview panel opens beside chat.
- Telegram carries the same digest and approval cards.
- Scheduled rhythms: morning digest about 6:30 am, Box watcher, Thursday and Friday pre-air verify.
- Data lives in Box (audio), Google Drive (2026 tracklists, read once), Dropbox Paper (show notes), Convex (station play history for 88nine and hyfin), Mixcloud (posted shows), an AgentMail inbox (forwarded and Bandcamp emails).
- Hosted on Nebius; models on Nebius Token Factory (NVIDIA Nemotron).

## Capabilities and Constraints

- Structural guardrails, enforced by tests: the agent drafts and a signed-in human approves; no source or Mixcloud credentials in the agent; email is data; the `rhythmlab` stream is never queried; closing tracks are never researched.
- Generated UI through OpenUI from a fixed component library (PackageCard, TagRow, StatRow, FlagList, TracklistTable, ReleaseCard, ClaimReport, ApprovalBar). Buttons call the app, not the model.
- Public descriptions are capped at 1,000 characters (Mixcloud limit).
- No on-air talk, scripts or social copy.

## Brand Commitments

- Name: **Air Check**. A radio term: a recording of a broadcast, played back to check it.
- Identity is a producer's desk: warm paper, ink, one green signal color, a broadcast-red "on air" accent used rarely. Not the LCARS look of TarikOS, and not a copy of any chat product.
- Honesty over polish: sample data is labeled "Sample", unverified claims say so, placeholders are bracketed rather than invented.

## Anti-references

- Generic AI chat clones with a centered orb and gradient washes.
- Dashboards full of charts that carry no decision.
- Dark "hacker" terminals. The point is that this is calm and legible.
- Emoji, decorative icons, and promotional language in the interface.

## Evidence on Hand

- A clickable mock (`design/mockups/`) with sign-in, digest, chat with a generated package card, package preview, backlog table, tracklist entry with live parsing, and audit log.
- A hand-built 10-2-26 package (`fixtures/`) as the acceptance test.
- Five working station skills (`skills/`).
- Verified Mixcloud upload API facts in `docs/ARCHITECTURE.md` section 3.5.
