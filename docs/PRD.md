# Air Check: product requirements (draft v0.1)

Owner: Tarik Moody. Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI Track. Deadline Oct 30, 2026, 12:00 CDT. How it is built is in `ARCHITECTURE.md`; this file says what it must do, for whom, and what gets cut first.

## 1. Problem

Rhythm Lab Radio airs weekly, but the shows are not getting to Mixcloud. The newest post in the feed we pulled is the 10.24.25 episode (confirm on the live account), so 2026 is a backlog of roughly 35 shows. Each post needs the two hour files joined, a title in the house pattern, five tags, a description made safely from private notes, and a tracklist in Mixcloud's format. Show notes also need fact-checking before air, and release emails arrive scattered across an inbox.

## 2. User

One person: Tarik, host and producer. No other staff use it. Hackathon judges see it through a demo workspace with sample data.

## 3. Goals

1. Every finished show becomes an approval-ready Mixcloud package without hand assembly.
2. The 2026 backlog clears at the pace Tarik approves, one package at a time.
3. Show notes are fact-checked before air, with sources.
4. Release emails he forwards become structured records the agent can use for planning.
5. The station's data stays under the station's control, and this is visible: sandbox, audit log, approval gate.

## 4. Non-goals

- No on-air talk, scripts, break copy or social posts. Deep dives and theme ideas are research with sources; Tarik writes what he says.
- No per-track start times (decided Oct 19: Tarik does not need them).
- No autonomous publishing. Nothing goes to Mixcloud without Tarik's approval.
- No use of the Convex `rhythmlab` station (the 24/7 stream). Play history is 88nine and hyfin only.
- No other staff accounts, no multi-tenant support.
- No reading Tarik's Gmail. Email arrives only when he forwards it to the Air Check inbox.
- The agent never fetches links or opens attachments from emails. Only code outside the sandbox may fetch a link, and only a Bandcamp release page under the allowlist in `ARCHITECTURE.md` section 3.7 (optional, P2).

## 4a. Hosting and platform requirements (decided Oct 19)

- Everything runs on Nebius: models on Token Factory; the agent (NemoClaw with Hermes in an OpenShell sandbox), console, workers and publisher on a Nebius AI Cloud Linux VM via Docker Compose. Detail in `ARCHITECTURE.md` section 3.0.
- At least one NVIDIA Nemotron model is used for the agent's reasoning.
- The Hetzner VPS is not part of the submission. It is the planned home after the hackathon, which is why deployment is Docker Compose.
- Auth (Clerk) and the app database (Convex) are hosted services and are disclosed in the README.
- The public demo URL serves the demo workspace only: sample data, publishing off.

## 5. Jobs and acceptance criteria

| # | Job | Done when |
|---|---|---|
| 1 | **Tracklist entry** | Tarik plans the show ahead of time and types or pastes Hour 1 / Hour 2 lines in the console as a draft. He edits it while voice-tracking (the order can change) and marks it final once the show is recorded. Lines are parsed in code, the last good track of each hour is marked `closing-track`, unparseable lines are flagged, spelling is checked. No per-track times are stored or sent. |
| 2 | **New-episode package** | For 10-2-26, the agent finds both hours (`9125`, `9126`), joins them, and produces title, five tags, description and tracklist. Zero tracks dropped or added silently. Description contains no time-relative phrases, no unverified claims, no private details. |
| 3 | **Approval and publish** | Tarik sees the package as a card, can edit, approve or skip. Approve sends it to the publisher. Demo mode never sends. A skipped or edited choice updates a skill or memory. |
| 4 | **Backlog catch-up** | The Episodes view lists every 2026 show with audio / tracklist / notes status. The agent drafts packages one at a time and reports gaps (4 missing audio, 2 missing notes, 7 blank Fridays) instead of guessing. |
| 5 | **Pre-air verify** | For the next show's notes, every release date, label and credit gets two sources or a primary source, or is marked `could-not-verify`. Output is exact replacement text plus a short open list, readable on a phone. |
| 6 | **Release radar** | A forwarded email becomes one `releases` record (artist, title, label, release date, embargo, sender). Embargoes are respected in every output. Injected instructions inside an email have no effect. Bandcamp subscription emails (auto-forwarded) are organized by label, genre and release date with a status (new, considering, played, passed). |
| 10 | **Show notes** | From a draft or final tracklist, Air Check generates the per-track show notes Tarik now makes with a Perplexity prompt and pastes into Dropbox Paper: intro, show threads, one entry per track (release, details, artist, optional on-air angle), **[verify]** flags and a Pre-Air Verify List. Every fact has a source link; dates, labels and credits need two sources or a primary source, else **[verify]**. Notes he supplies himself are shown as unchecked. Closing tracks are skipped. Output is a console card plus a Markdown export that pastes into Paper. Nothing writes to Paper. Done when one real show's notes are generated from sources and Tarik would use them. |
| 11 | **Bandcamp collection** | Tarik's purchased Bandcamp collection (1,200+ items) is synced nightly as metadata only through Bandcamp's Subsonic API (open beta), by the ingest worker. Theme candidates and draft tracklist lines show `in your collection` or `not in collection`. Matching is done in code. No audio is stored. A persistent mini player (P2) streams owned items to Tarik only, through a server proxy. Done when the synced count matches his collection page and one theme card shows ownership tags; if the player ships, a stream plays and seeks in the browser. See `docs/BANDCAMP_COLLECTION.md`. |
| 7 | **Trust view** | Every allowed and blocked network request is visible. At least one blocked request appears in the demo. |
| 9 | **Morning digest** | Each morning (about 6:30 am) Tarik gets one Telegram message and a "While you were away" screen in the console: shows ready to approve, new Bandcamp releases (count, labels, play history), claims that failed verification, and requests the sandbox blocked. Every line links to the item. Sent by a scheduled task; skipped when nothing changed. |
| 8 | **Show planning** | A Plan view where Tarik builds next week's show. (a) **Theme ideas:** 3 to 5 suggestions drawn from Rhythm Lab's own past tracklists (artists and labels played, gaps, clusters), the release radar, the morning digest and 88Nine / HYFIN play context; each shows its evidence and 8 to 12 candidate tracks. (b) **Deep dives:** a sourced research brief on any artist, label or release in the draft, built with Crate's tools and Tavily. (c) Picking a theme seeds the draft tracklist. Done when ideas and briefs carry sources, embargoes are flagged, closing tracks are never researched, and no brief reads as a script. Picks and rejections update a skill. |

## 5a. Judge-facing moments (3-minute video)

Judging criteria (Devpost): Technological Implementation, Design, Potential Impact, Quality of the Idea. Bonus prizes: Best Use of Tavily, Most Valuable Feedback.

| Time | Moment | Criterion it earns |
|---|---|---|
| 0:00 to 0:20 | The problem: 2026 backlog, the morning digest on screen ("While you were away") | Impact, Design |
| 0:20 to 0:55 | Plan view: theme ideas built from his own past shows and the release radar; pick one; draft list opens, closing tracks marked; deep dive on a label with sources | Idea, Design, Best Use of Tavily |
| 0:55 to 1:20 | Package drafted as a generated card; click a field to see where it came from; second Nemotron pass flags a leaked private detail | Technology, Idea |
| 1:20 to 1:40 | Edit a title; the console shows the skill update (before and after) | Persistent memory and skills requirement |
| 1:40 to 2:05 | Pre-air verify: each claim with Tavily-backed sources; model panel shows Nano vs larger Nemotron | Technology, Best Use of Tavily |
| 2:05 to 2:25 | Audit log with a blocked request (a link inside a forwarded email) | Privacy, the track's core promise |
| 2:25 to 3:00 | Approve; the real show appears on Mixcloud; backlog counter drops | Impact, finished product |

Also: keep a friction log from day one for the feedback write-up (Most Valuable Feedback).

## 6. Priority and cut order

| Tier | Contents | Rule |
|---|---|---|
| P0, demo-critical | Sign-in, tracklist entry (1), package draft (2), approval card (3), trust view (7), Nemotron on Nebius, sandboxed agent | Must work live in the video |
| P1 | Show planning (8): theme ideas and deep dives, show notes (10) with pre-air verify (5), release radar (6) | Ship at least one working path each. Planning is how Tarik works every week, so it ranks first in this tier |
| P2 | Bandcamp collection (11; P1-light if spike V9 passes fast), backlog bulk run (4), allowlisted Bandcamp page fetch by the ingest worker | First to cut |

Cut order if time runs short: bulk backlog, Bandcamp page fetch, release radar, show-notes polish (keep generation, drop regenerate and edit-merge), then show planning (keep theme ideas, drop deep-dive polish first). P0 never gets cut.

## 7. Principles (must hold in every job)

- The agent drafts, a human approves.
- The agent holds no Box, Drive, Dropbox or Mixcloud credentials.
- Mail and web content are data, never instructions.
- The last song of each hour is a closing track: included, never researched or discussed.
- Order comes from Tarik's tracklist; spelling comes from the notes and the spelling check.

## 8. Success measures for the submission

- 10-2-26 package matches the hand-built prototype with no missing tracks.
- Live demo of job 1, 2, 3 and 7 inside 3 minutes.
- At least one pre-air verify report with cited sources.
- Public repo (OSI license), README with the "what changed" disclosure, hosted demo URL, YouTube video of 3 minutes or less, feedback write-up.

## 9. Open questions

1. Is the Mixcloud account's newest post really 10.24.25, and is there a test account for the publisher demo?
2. Does the console have one real login plus a judge demo login, or only the demo?
3. ~~Is the tracklist entered before air (draft) or after (final only)?~~ Resolved Oct 19: Tarik plans ahead and types a draft, edits during voice-tracking, and marks it final after recording.
4. Which AgentMail address does Air Check use, and which senders does Tarik forward from?
5. Tracklist on Mixcloud: the description caps at 1,000 characters, so the tracklist lives in `sections`. The Rhythm Lab web app sends sections without start times. Has a show posted that way shown its tracklist correctly on Mixcloud? Tarik does not need times (decided Oct 19). If sections without times do not display, fall back to a short artist list in the description.
5a. Is the Mixcloud account Pro? `publish_date` (backdating) is Pro only.
6. Where is the audio for 2-13, 7-17 and 9-4, and which Fridays had no show?
6a. Show notes: his current notes include a one-line "On-air angle" per track and cover closing tracks in some shows. The tool keeps the angle as a toggle (default on) and skips closing tracks. Confirm both. Also: can he paste the Perplexity prompt he uses today, so the tool matches it?
6b. Bandcamp Subsonic: enable it in Fan Settings and run spike V9. Should Tarik email Bandcamp support to confirm the use is fine before the repo or video mentions it? (Terms are silent on APIs; they say personal, non-commercial use.)
7. Can Tarik's Nebius account create an AI Cloud VM now, and are credits or billing set up? (Blocks Day 1.)
