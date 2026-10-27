# Air Check: design (Oct 26, 2026)

Status: **approved by Tarik, Oct 26, 2026.** Written after a brainstorming session that read every file in this handoff folder plus the CopilotKit `openmuse` repo.

This document does **not** restate the handoff. The handoff docs remain the detailed source of truth. This file says what Air Check is, which doc governs what, and what was decided on Oct 26 that changes or adds to them. Where this file and an older doc disagree, this file wins, and the older doc must be updated (section 9).

Calls marked **(Claude's call)** were made by Claude without Tarik's explicit say. Tarik should check those while reading.

---

## 1. Intent

Air Check is a private, always-on producer for Rhythm Lab Radio, Tarik Moody's weekly show on Radio Milwaukee. It helps him plan each show, writes sourced show notes, checks facts before air, organizes release emails, and turns finished shows into Mixcloud-ready packages that publish only after he approves them.

**Why it exists:** shows stopped reaching Mixcloud (about 35 from 2026 are unposted). Each post means hand assembly: join two hour files, write a title in the house style, pick five tags, write a safe public description from private notes, and format a 31-track tracklist. Show notes come from a Perplexity prompt pasted into Dropbox Paper, and facts in them have been wrong before. Release emails are scattered across an inbox.

**What makes it different:** most agent products ask you to trust them. Air Check shows its work. The agent runs in a sandbox that can reach only an approved list of hosts, every request it makes (allowed or blocked) is logged where Tarik can read it, every fact carries a source, and nothing goes public without a signed-in human pressing Approve.

**It is also a hackathon entry:** the Nebius x NVIDIA Global AI Hackathon, Personal AI Track. Track brief, verbatim: "Build an always-on, private assistant that works for you while keeping your data under your control. Give it persistent memory, reusable skills, access to the tools and information you choose, and the ability to carry out tasks across your daily workflows. Use at least one NVIDIA open source model, and use tools such as NVIDIA NemoClaw, OpenShell, Hermes Agent, and Nebius Serverless to bring personal AI to assemble, secure, and run your own personal AI system." Rule: "All submissions must run on either Nebius Token Factory or Nebius AI Cloud and use at least one NVIDIA open source model."

**Official rules, checked Oct 26** at nebiusglobalaihackathon.devpost.com (rules and FAQ pages). Points that shape the design:
- The app must make a runtime call to Token Factory or run on Nebius AI Cloud, and use at least one NVIDIA open model. FAQ: "the rest of your app (web frontend, unrelated backend processing) doesn't also need to be hosted on Nebius AI Cloud." So **Clerk and Convex are allowed.** Calling Nemotron through another provider (OpenRouter, Hugging Face) does not count.
- Stage One is pass/fail: does the project "reasonably fit the theme" and "reasonably apply the required APIs/SDKs featured in the Hackathon". The Personal AI Track names NemoClaw, OpenShell, Hermes Agent and Nebius Serverless "as tools such as". Using them is the safe reading of Stage One.
- Stage Two scores four criteria with equal weight: Technological Implementation, Design ("a complete, coherent product experience not just a technical proof of concept"), Potential Impact, and Quality of the Idea.
- **Judges must be able to test it free and without restriction until the judging period ends (Dec 15, 2026).** If the site needs a login, the testing instructions must include credentials. So the demo workspace, its login and the Nebius VM must stay up through Dec 15.
- The video must be under 3 minutes, on YouTube, show the project working, and **must not include copyrighted music or third-party trademarks without permission**. Show audio and track playback in the video need care.
- The repo is public, with an open source license visible in the repo's About section, plus a README covering setup, Nemotron use, Token Factory and other Nebius tools. The submission also needs feedback on Nebius and NVIDIA tools. A project that existed before Aug 26 must explain what was significantly updated.
- Third-party APIs and data must be used within their terms. This applies to the Bandcamp Subsonic question (`docs/BANDCAMP_COLLECTION.md`).
- Submissions must be "solely owned by" the entrant. Air Check is built around a Radio Milwaukee show, so Tarik should confirm the station has no claim on it. This is not legal advice.
- Prizes: each project can win one Overall Award, or one Track Award plus one Bonus Award. The bonuses are Best Use of Tavily (it needs a functional runtime call to Tavily) and Most Valuable Feedback.

**Dates are out of scope for this design.** Tarik said to ignore dates and deadlines. The handoff's day-by-day calendar (`BUILD_PLAN.md` days 2 to 11) is not a constraint. Priorities and cut order (`docs/PRD.md` section 6) still are.

## 2. Users

1. **Tarik**, the only real user. Works in short sessions: plans and types the tracklist ahead of time, voice-tracks, marks it final, approves packages, checks facts before air. Reads the digest on his phone around 6:30 am (Telegram) and works at a desk in the console. **He approves from his phone too** (section 5.1).
2. **Hackathon judges**, who open a demo workspace with sample data and publishing switched off, and watch a video of 3 minutes or less.

## 3. Goals, non-goals, anti-goals

**Goals** (from `docs/PRD.md` section 3, unchanged): every finished show becomes an approval-ready package without hand assembly; the 2026 backlog clears at Tarik's pace; show notes are fact-checked with sources before air; forwarded release emails become structured records; the station's data stays under its control, visibly.

**Non-goals** (from `docs/PRD.md` section 4, unchanged): no on-air talk, scripts, break copy or social posts; no per-track start times; no autonomous publishing; no `rhythmlab` station queries; no other staff or tenants; no reading Gmail; the agent never fetches links or opens attachments from email.

**Anti-goals** (would make it a failure even if it technically works):
- Any path, however indirect, by which model output triggers a Mixcloud upload.
- A Trust view that shows a curated or partial log. If the agent reached something, it shows.
- Claims presented as fact without a source, or counts and dates the model made up.
- Looking like a generic AI chat (orb, gradients, dark hacker terminal, emoji). See `PRODUCT.md` anti-references.
- Sample data that is not labeled as sample.
- An "AI browser" that opens web pages. Explicitly rejected on Oct 26 (section 5.3).

## 4. Constraints and where they live

| Constraint | Source of truth |
|---|---|
| The 13 hard rules (approval, credentials, stations, closing tracks, email-as-data, description rules, no talk, no telemetry, demo cannot publish, research not scripts, no start times, show notes rules, Bandcamp metadata) | `CLAUDE.md` "Hard rules". Each must be enforced by a test. |
| Stack: NemoClaw + Hermes Agent + OpenShell on Nebius; Nemotron on Token Factory; Next.js + Tailwind + Clerk + Convex console; OpenUI generated UI | `README.md` "Decisions already made", `docs/ARCHITECTURE.md` section 3. **Confirmed Oct 26: Hermes and NemoClaw are required by the hackathon and stay.** |
| Hosting: one Nebius AI Cloud VM, Docker Compose, only 443 public, dashboard and API on loopback | `docs/ARCHITECTURE.md` 3.0, `docs/NEBIUS_SETUP.md` |
| Credential separation: the agent holds no Box, Drive, Dropbox, Mixcloud or Subsonic credentials | `docs/ARCHITECTURE.md` 3.1, 3.3, 3.5, 5 |
| Mixcloud upload facts (fields, 1,000-char description, 5 tags, sections, Pro-only `publish_date`, 403 `Retry-After`) | `docs/ARCHITECTURE.md` 3.5, `reference/REUSE.md` |
| Visual design | `DESIGN.md` tokens and rules, `PRODUCT.md`, the renders in section 6.1, `design/mockups/*.dc.html` for copy and behavior. Run the Impeccable design skill before building any screen (`CLAUDE.md` "Design"). |
| Station skills (8, already written) | `skills/*/SKILL.md` |
| Acceptance fixture | `fixtures/RLR-10-2-26-mixcloud-package.md`: 31 tracks (15 + 16), both closing tracks marked, same spellings, nothing dropped or added |
| Show-notes target format | `fixtures/show-notes-format.md` |
| Licenses: Air Check repo is MIT or Apache-2.0; rhythm-lab-app is BSL 1.1 (ask before copying); Crate repos have no license (call over MCP, do not copy); Feishin is GPL (read only); openmuse is MIT (patterns may be copied with attribution) | `reference/REUSE.md`, `docs/BANDCAMP_COLLECTION.md`, section 7 below |
| Station identifiers | `PRIVATE_NOTES.md`. Never commit it. |

## 5. Decisions made Oct 26

### 5.1 Phone approval goes through a link into the console (Tarik)
1. When a package is ready, Telegram gets a short card: title, track count, number of flags, and a **Review package** link.
2. The link opens that package's own page in the console (`/packages/<id>`). If the Clerk session has expired, Tarik signs in and lands back on the same package.
3. Approve, Edit and Skip exist only on that page. The link carries only the package id. Opening it never approves anything. There are no approve buttons inside Telegram.
4. Approve calls an app route with the signed-in session (section 7.1 describes the gate).

Consequences: each package needs a stable URL, not only a card inside a chat thread. **The package review page must work well at phone width**, which the existing mockups never tested. Because Telegram only notifies and links, Hermes's own Telegram gateway is fine to use; a separate bot service is not needed **(Claude's call)**.

### 5.2 openmuse is a pattern reference, not a dependency (joint)
The CopilotKit `openmuse` repo (MIT) is inspiration for the agent-facing parts of the console. Tarik named three features: the Ideas accept/edit/dismiss flow, the Activity and receipts view, and the browser-takeover console. Hermes remains the agent. What to borrow, and what not to, is in section 7.

### 5.3 "Take over" means taking over the draft, not a browser (Tarik chose option A)
openmuse's agent drives a real browser and the user can take control of it. Air Check does not get an agent browser: it would break the no-links rule and widen the sandbox allow-list, which is the core privacy promise. Instead:
- Long jobs (show notes, deep dive, pre-air verify, package build) show **live progress** in their card: the current step ("Checking release dates · 12 of 29 tracks") and sources appearing as they are found.
- **Take over** stops the agent at the next step boundary and opens what it has so far in an editor.
- Blocks Tarik has edited are marked as his. Regenerating never overwrites them without asking (already required by `skills/rlr-show-notes`).
- **Resume** hands the remaining steps back to the agent, which skips the edited blocks.

### 5.4 Smaller decisions
- **Nav order** follows the Oct 26 renders: Today, Chat, Plan, Tracklist, Episodes, Release radar, Trust, Skills and memory (Tarik, via the renders).
- **The database stays Convex Cloud, disclosed in the README**, as the handoff decided. The hackathon FAQ confirms that only the model call has to be on Nebius (section 1). Nebius's Managed PostgreSQL was considered and is not needed. Nebius has no end-user sign-in service, so Clerk stays.
- **Approval has no time limit.** openmuse expires a review after 30 minutes. Tarik may open the morning digest hours later, so an Air Check package stays approvable until its contents change (section 7.1) **(Claude's call)**.

### 5.5 Media worker runs as a Nebius Serverless Job (Tarik, Oct 26)
The track names Nebius Serverless. The ffmpeg join-and-encode runs only when a show is approved, so it fits a serverless job, and it keeps audio off the agent's VM. Unverified: job limits, and scratch disk size (two WAVs are about 1.26 GB). Spike V10 tests it first. If it fails, the media worker stays a container on the VM. The fallback must be written up in the README and the feedback write-up, not hidden.

### 5.6 Calls made after the builder review (all Claude's calls)
- **One public host, two doors.** The console is one site behind HTTPS and Clerk. Signing in with an @radiomilwaukee.org account opens Tarik's real workspace, which is what the phone link needs. The demo door opens the demo workspace. This replaces PRD 4a's "the public URL serves the demo workspace only": the URL is public, and the real workspace behind it requires Tarik's sign-in.
- **The demo workspace is fully separate.** It has its own sample data, and its chat runs in a second, named Hermes sandbox with sample memory and copies of the base skills. It never touches Tarik's MEMORY.md, learned edits, Box corpus or Bandcamp collection. The publisher refuses demo packages (Hard Rule 9). The demo shows the 10-2-26 package's titles, tags, tracklist and flag wording as in the mockups, but never the text of the private detail that the flag says was left out.
- **Learned changes stay private.** The `skills/` files in the repo are the base versions. What the agent learns from Tarik's edits, picks and dismissals is stored privately, in the real sandbox's memory and Convex, and shown in Skills and memory as a diff against the base. It is never committed automatically. Tarik can copy a learned rule into the repo by hand.
- **Golden test inputs.** Commit the raw 10-2-26 Drive tracklist, typos included, since the show has aired and the tracklist will be public on Mixcloud. Commit a redacted excerpt of the Paper notes that keeps the diacritics, the VERIFY list and a synthetic "handle with care" line in place of the real one. The full private notes stay out of the repo. A second, private test run against the real inputs is optional.
- **Setup state is checked first.** The plan's first task is to check what already exists (Nebius VM, billing, Token Factory key, Clerk and Convex projects, Telegram bot, Mixcloud app) before doing the Day 1 setup.

### 5.7 Answers from Tarik after the review (Oct 26)
1. **Where descriptions come from.** For 2026 backlog shows, from the Paper notes, as the skills already say. For new shows, from Air Check's own show notes, run through the same `rlr-description-safety` rules. This is a filtered rewrite, never a paste (Hard Rule 12). Two consequences:
   - A new show's package needs its show notes to exist first. Before drafting, the package flow checks for notes and asks to generate them if they are missing.
   - The safety filter needs a "handle with care" signal, so show-notes entries can be marked private by Tarik or by the generator. Marked items never reach a description.
   - The P0 demo uses 10-2-26, a backlog show with Paper notes, so P0 does not depend on the P1 show-notes feature.
2. **Approve publishes publicly.** It does not upload unlisted. The `unlisted` upload stays as a test tool for spike V5 only. **(Claude's calls, which Tarik did not object to.)** Backlog shows post oldest first, at most 3 per day, so followers' feeds are not flooded with 35 shows dated today. Each post uses one standard Rhythm Lab cover image unless Tarik picks another on the package page. Because a public post is permanent, the package page shows "This will be public on Mixcloud" next to Approve.
3. **Keep Convex and Clerk.** The FAQ confirms Nebius is not required for the database (section 1).
4. **Serverless media job: yes** (5.5).
5. **The demo is live by default, with a scripted backup.** Judges' chats call Nemotron live. A switch flips the demo to the scripted path, and every card is labeled with which path produced it ("Live · Nemotron" or "Sample · scripted"). Judges can test until Dec 15, so the demo has a per-session rate limit and a daily cap on model calls; when the cap is hit, it falls back to scripted **(Claude's call)**.
6. **Most of the setup exists**, by Tarik's account. The plan's first task checks each item (5.6) rather than redoing setup.

### 5.8 Persistent player plays both the finished show and planning tracks (Tarik, Oct 26)
A play bar is fixed at the bottom of the console. A single `<audio>` element lives at the app root, so playback survives moving between screens. The bar shows what is playing, play and pause, seek, volume, and the queue. Space bar toggles play.

**Sources:**
1. **Episode preview.** The finished, joined MP3 of a show, played from the package page or the Today card. Controls are play and seek, plus **Jump to hour 2**, which uses the measured length of hour 1. That hour boundary is not a track start time, so Hard Rule 11 still holds. The player does not jump between tracks, because no track times exist.
2. **Planning tracks.** Items from Tarik's own Bandcamp collection, played from theme-card candidates, radar records and draft tracklist lines that match `owned`. The queue is the draft tracklist in order, as in `docs/BANDCAMP_COLLECTION.md`.

**This changes the order of steps.** Audio is joined and encoded **when the package is drafted, not after approval**, so Tarik hears exactly what will go public. The package fingerprint (7.1) includes the MP3's hash, so the file the publisher uploads is the file he previewed. A Skip deletes the prepared MP3. A successful publish deletes it after upload.

**Storage (Claude's call):** prepared MP3s are kept private, and at most 3 at once, matching the 3-a-day backlog pace. Others are prepared when Tarik opens them. Where they live (VM disk or a private Nebius object storage bucket) is left to the builder, depending on what spike V10 shows about the Serverless job's output.

**Rules:**
- Audio streams only to a signed-in @radiomilwaukee.org user, through a console server route that passes `Range` headers so seeking works. The browser never sees Box or Subsonic credentials.
- The agent has no access to any stream.
- Nothing is downloaded or cached by the browser beyond normal playback. Bandcamp audio is never stored (Hard Rule 13).
- **Demo workspace:** the player works but plays only royalty-free sample clips, for both sources. The video rule bans copyrighted music, and the demo never uses Tarik's collection.

**Reference:** Feishin's web player, for queue and seek handling. Read only, because it is GPL-3.0 (`docs/BANDCAMP_COLLECTION.md`).

## 6. The product, screen by screen

### 6.1 Visual reference
Two Oct 26 renders are the newest visual reference: the Chat screen with a package card and preview panel, and the Today screen. They should be copied into `design/mockups/` as `render-chat-package.webp` and `render-today.webp` (sources were `~/Downloads/preview (1).webp` and `preview (2).webp`). They match `DESIGN.md`, with these differences, which win over the HTML mock:
- The nav order in 5.4. "Trust and audit" is shortened to "Trust". Square nav markers replace the mono hints.
- The logo is a waveform mark plus the serif wordmark.
- PackageCard stats read "31 tracks · 2 closing tracks · 5 tags". The old "0 section times" line is gone.
- The demo notice sits beside the action buttons.
- Today is two columns: decisions on the left, trust and Telegram on the right.

Fix these in the build **(Claude's calls)**:
- The `closing track` chip uses the neutral chip color, not green. Green means ready or approved (One Signal Rule).
- The Telegram preview bubble's light blue becomes a named token (`telegram-bubble`) in `DESIGN.md`, or it switches to `surface-quiet`.
- Primary and secondary buttons must not wrap their labels at card width. Shorten the copy ("Approve", "Review") or widen the row.

### 6.2 Screens
The jobs and acceptance criteria are in `docs/PRD.md` section 5. This section adds only what changed.

| Screen | Requirements (new on Oct 26 in bold) |
|---|---|
| Sign-in | As in `Main.dc.html`. Clerk, limited to @radiomilwaukee.org, plus a separate demo-workspace door. |
| **Today** | As in the render. Each line links to its item. **"Review package" goes to `/packages/<id>`.** |
| Chat | Agent replies render as registered OpenUI components only (`docs/ARCHITECTURE.md` 3.8). **Long jobs show live progress and Take over (5.3).** The preview panel stays. |
| **Package page `/packages/<id>`** | **New. The full package (title with alternates, tags, description with character count, tracklist with closing-track chips, audio files, review flags, field provenance), the actions Approve, Edit and Skip, and after publishing, the receipt. Must be fully usable at 375px width with 44px targets. This is the page the Telegram link opens.** |
| **Plan** | **Theme cards follow openmuse's Ideas flow (7.2).** Deep dives use the DeepDiveCard with live progress and Take over. Picking a theme seeds a draft tracklist. Rules in `skills/rlr-theme-ideas` and `skills/rlr-deep-dive`. Still undesigned. Design it first among the undesigned screens. |
| Tracklist | As in the HTML mock: live parse, `H1.3` labels, closing-track chips, flags on unparseable lines, draft then final. Spelling check through Crate. |
| Episodes | 2026 backlog table with audio, tracklist and notes status. |
| Release radar | Records from forwarded email. Status new, considering, played or passed. **Uses the same accept/edit/dismiss interaction as theme cards** **(Claude's call)**. Still undesigned. |
| **Trust** | **Three parts, modeled on openmuse Activity (7.3): Waiting for you, What the agent did, What it tried to reach.** At least one blocked request must appear in the demo. |
| **Player bar (every screen)** | **New (5.8). Fixed at the bottom, above the phone's safe area on mobile. Sits under the sidebar and preview panel without covering the composer. Not yet designed.** |
| Skills and memory | Skills as readable files with edit history. **The "what I learned" before-and-after diff after an edit, pick or dismissal.** Still undesigned. |

Also still undesigned, per `design/README.md`: the provenance view for each package field, the model panel (which Nemotron handled which step), and empty, loading, error and offline states.


### 6.3 Approved layouts (Oct 26 design pass, Impeccable)
Mockups are HTML pages built with DESIGN.md's tokens and screenshotted with headless Chrome. The OpenAI image key was invalid, so Tarik chose HTML mockups instead. Approval records are the `*.json` files next to each image in `.impeccable/mocks/decision/`.
- **Package page (phone): "One-screen decision"** (`one-screen.webp`, seed `1845fda8`). One white card holds the serif title, tags, three counts (tracks, closing tracks, description characters) and the numbered review flags, with a "See description, tracklist and sources" link. Below it come the player bar with "Jump to hour 2", the line "This will be public on Mixcloud", and stacked Approve, Edit and Skip. Flags come first, as Tarik asked. Not chosen: checklist-gated Approve, and a before/after "What changed" list.
- **Trust (desktop first): "One timeline"** (`trust-timeline.webp`, seed `21307efd`). Filter chips (All, Waiting for you, Agent actions, Network, Blocked), then one wide table with time, kind, what happened, where and result. Blocked rows are tinted red with the reason. Risk named on the card: blocks stand out less for a skimming judge, so the demo workspace may default the filter to Blocked **(Claude's suggestion, not decided)**. Not chosen: rules-plus-log, and incident reports.
- **Live-progress + Take over card** (`progress.webp`). A progress bar with "N of M tracks · closing tracks skipped", then one row per track with its source chips and any `[verify]` chip, the current row marked "Working", and closing tracks shown "Skipped". A Take over button reads "stops after this track and opens the draft". Approved as is.
- Craft rule applied: no eyebrow label above headings on new surfaces. Status is carried by pills ("Draft · 2 flags") instead.

## 7. What to take from openmuse

Cloned and read on Oct 26 (commit `a4944f4`): README, `docs/EXPERIENCE.md`, `docs/VERIFICATION.md`, `docs/COMPUTER.md`, `docs/RICH-THREADS.md`, `docs/demos/jev-generative-ui.md`, `infra/compose.yaml`, `apps/server/src/actions.ts`, `apps/server/src/engine/tanstack-agent.ts`, the Ideas service (`apps/server/src/engine/service.ts` around `refreshIdeas` and `decideIdea`), domain types (`packages/domain/src/agent.ts`, `index.ts`), `ActivityScreen` in `apps/mobile/src/screens.tsx`, and `apps/mobile/src/browser-tool-card.tsx`. Not read: the rest of the task engine, the browser worker's `network.ts` and `proxy.ts`, and most of the mobile UI.

### 7.1 Approval gate (`apps/server/src/actions.ts`)
This is the shape Hard Rule 1 needs:
1. The agent can only submit a package, by calling `package.submit`. That saves it with status `awaiting_review` and a **fingerprint** (a hash of its exact contents: title, tags, description, sections, audio file ids).
2. Only the console's signed-in approval route can decide. It must receive the fingerprint the page showed. If the package changed since then, approval fails with "This package changed. Open the latest version."
3. Approval **claims** the package atomically (`awaiting_review` → `approved`), so a double tap or two devices cannot publish twice.
4. The publisher accepts only claimed, approved packages. If an upload's result is uncertain (a timeout after the bytes were sent), status becomes `outcome_unknown`, it is **not retried automatically**, and Tarik decides.
5. Every transition writes an activity row (feeds 7.3).
6. Demo workspace: the approval route works and records the approval, but the publisher refuses any demo-workspace package (Hard Rule 9).

Not copied: the 30-minute expiry (5.4).

### 7.2 Ideas flow → theme cards
openmuse ideas have a title, a reason, **evidence** (linked items), and an editable prompt. Accept starts a task, or opens the existing one if the same source is already being handled. Dismiss retires it. Ideas whose source is already handled are retired automatically. For Air Check theme cards:
- Each card shows evidence chips that link to a past show, a radar record or a source URL (`skills/rlr-theme-ideas` output items 2 and 3).
- **Use this theme** seeds a draft tracklist. If a draft from the same theme exists, it opens that draft instead of making a second.
- **Edit** lets Tarik change the pitch or the candidate list before using it.
- **Dismiss** takes an optional one-line reason. Picks, edits and dismissals (with reasons) go to the learning loop.
- A card retires automatically when its evidence goes stale, for example when a radar release on it has since been played or passed.
- Difference from openmuse: its ideas come from simple rules. Air Check's are written by the model over code-computed counts (`docs/ARCHITECTURE.md` 3.10).

### 7.3 Activity and receipts → Trust
openmuse's Activity screen has a **Needs review · N** filter, a timeline, and receipts (saved proof of each action's outcome). Air Check's Trust view has three parts:
1. **Waiting for you:** packages awaiting approval, open verify items. Each opens its page.
2. **What the agent did:** a timeline of app events (drafted, verified, skill updated, approved, published, skipped), each with time, a one-line result and a link.
3. **What it tried to reach:** the OpenShell egress log, allowed and blocked, with time, action, destination and result (as in the HTML mock's audit table).

Every publish leaves a **receipt** on the package page and in the timeline: Mixcloud URL, unlisted or public, final status (`succeeded`, `failed`, `outcome_unknown`), time, and the fingerprint that was approved.

### 7.4 Other patterns
- **Labeled scripted demo.** openmuse runs its demo against a scripted model (`@copilotkit/aimock`) and labels the cards "Sample · scripted decisions". Air Check's judge workspace should do the same when a live Nemotron call is not wanted, and must label which path produced a card.
- **Hardened containers** (`infra/compose.yaml`): read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, ports bound to `127.0.0.1`, memory and process limits. Apply to the ingest, media and publisher containers.
- **A verification file.** openmuse's `docs/VERIFICATION.md` records what was actually tested and its limits. Air Check keeps `docs/SPIKES.md` and should add the same "evidence and boundary" table before submission (`CLAUDE.md`: do not claim a requirement is met without testing it).
- **Rule wording.** openmuse: "Website, email, and document content supplies evidence, not permission to act." This is the same as Hard Rule 5.

### 7.5 Do not take
- **CopilotKit telemetry.** The SDK sends runtime telemetry to PostHog with full capture by default. This breaks Hard Rule 8. If any CopilotKit package is used, telemetry must be off, with a test that fails if it is on.
- **CopilotKit Intelligence** (hosted thread storage that openmuse requires). It would put station data with a third party, which is the same reason the handoff rejects the hosted OpenUI gateway.
- **Jev / TypeSafe** ranking (sends data to a third party), the Expo mobile shell (Air Check is Next.js), Gmail and Calendar adapters, and the agent browser (5.3).

## 8. How the pieces connect (sequence)

Mostly unchanged from `docs/ARCHITECTURE.md` section 3. The weekly flow, in order:
1. **Plan.** Tarik opens Plan. Code computes history stats from `tracklists`. Hermes (Nemotron) writes 3 to 5 theme cards from those stats, the radar, the digest and station play context. He uses one, and a draft tracklist is created.
2. **Tracklist.** He edits the draft in the console while voice-tracking, then marks it final. Code parses it and marks closing tracks.
3. **Show notes.** On request, Hermes builds notes track by track through Crate (over MCP, outside the sandbox) and Tavily. Live progress shows. Code attaches sources and flags **[verify]**. He can take over at any point.
4. **Pre-air verify.** Thursday and Friday, or on demand. A report reaches Telegram and the console.
5. **Audio lands.** The ingest worker (which holds the Box credential) sees the folder and writes file metadata to the agent's corpus.
6. **Package.** With a final tracklist and both hours present, Hermes drafts the title, tags, description and sections using the skills, then calls `package.submit`. At the same time the media job (a Nebius Serverless Job, 5.5) joins and encodes the audio. The package becomes approvable only once the MP3 exists and its hash is in the fingerprint (5.8).
7. **Notify.** Telegram (through the Hermes gateway) sends the card with a link. Today shows it.
8. **Preview and approve.** Tarik opens `/packages/<id>` on his phone or at his desk. He can play the finished show in the player bar, then approves. The gate in 7.1 claims the package.
9. **Publish.** The publisher, which holds the Mixcloud token, uploads the same MP3 he previewed, writes the receipt, deletes the MP3, and the backlog count drops.
10. **Learn.** Edits and skips update a skill or memory, and the diff appears in Skills and memory.

## 9. Doc fixes required
These parts of the handoff are stale or contradict decided rules. Fix them when the repo is created, before building from them:
- `docs/ARCHITECTURE.md` section 1 (job "D, weekly adds brief"), section 7 (old demo script) and section 8 (old build plan) predate the PRD's newer video plan and jobs. Mark them superseded by `docs/PRD.md` 5 and 5a.
- `docs/ARCHITECTURE.md` 3.4 says it measures durations "so hour-2 section offsets are right", but no section times are sent. Remove it.
- `docs/ARCHITECTURE.md` 3.5 says the publisher accepts a package "approved in Telegram". Replace it with 5.1 and 7.1.
- `docs/ARCHITECTURE.md` 3.6 lists "approval cards (Approve / Edit / Skip)" in Telegram. Replace it with link-only cards.
- `docs/ARCHITECTURE.md` 3.12 says "no audio is streamed", but `CLAUDE.md` rule 13 and `docs/BANDCAMP_COLLECTION.md` allow the proxied player. Align it with rule 13.
- The HTML mock's PackageCard copy "Section times are not available yet. The audio has not been analyzed." Remove it (the renders already have).
- `CLAUDE.md` hard rules are numbered 1 to 11, 13, 12. Renumber them.
- `BUILD_PLAN.md` and `docs/PRD.md` give slightly different cut orders (pre-air verify vs. show-notes polish). PRD wins.
- `PRODUCT.md` says "five working station skills". There are eight.

## 10. Priorities
Unchanged from `docs/PRD.md` section 6, without dates:
- **P0** (must work live in the video): sign-in, tracklist entry, package draft, approval (now including `/packages/<id>` on a phone), Trust with a blocked request, Nemotron on Nebius, the sandboxed agent.
- **P1:** Plan (theme cards with accept/edit/dismiss, deep dives), show notes with pre-air verify, release radar. Live progress and Take over ship with whichever of these comes first.
- **Player (Claude's call on tiers):** joining the audio before approval is **P0**, because publishing needs the MP3 anyway and the fingerprint must cover it. The player bar with episode preview is **P1, high**, and ships with the publish pipeline. Without the bar, Approve still works. Bandcamp planning-track playback is **P2**, tied to spike V9.
- **P2:** Bandcamp collection and its playback, bulk backlog run, allowlisted Bandcamp page fetch.

Cut order is the PRD's. Additions: the provenance view and model panel cut before P1 items; live progress cuts before Take over. If time runs short, Take over can fall back to "Stop and edit".

## 11. Still unverified (the builder's first job)
The Day 1 spikes in `BUILD_PLAN.md` still apply, unchanged: V1 NemoClaw + Hermes install, V2 Nemotron through Token Factory, **V2b the console streaming chat with Hermes's API on port 8642** (now the single biggest risk), V3 Nemotron writing valid OpenUI, V4 Hermes calling Crate's MCP server, V5 and V6 Mixcloud sections without times and backdating, V7 Convex read-only plays, V9 Bandcamp Subsonic. Add:
- **V10:** a Nebius Serverless Job can download two WAVs, join them, encode an MP3 and hand it to the publisher (5.5).
- **V11:** the OpenShell activity log can be read by the console in close to real time, with enough fields for "What it tried to reach" (`docs/ARCHITECTURE.md` 3.1 flags that its format is undocumented).
- **V12:** Hermes can report step progress during a long job, and can be stopped at a step boundary, which Take over needs. If not, progress comes from our own tools writing step rows to Convex as they run, and Take over stops the job between tool calls.

Record results in `docs/SPIKES.md` and friction in `docs/FRICTION_LOG.md`.

## 12. Left to the builder
- Repo layout (`BUILD_PLAN.md` prompt 2 suggests one), license choice between MIT and Apache-2.0, and test framework.
- How the console talks to Hermes, within whatever V2b proves works, including whether any CopilotKit or AG-UI client package is used (7.5 applies if so).
- Convex schema details beyond the tables named in `BUILD_PLAN.md` day 2 plus the additions here: package `fingerprint` and `status` values, `receipts`, `activity`, job steps for live progress, and an `editedBy` marker on show-notes blocks.
- Exact component split and naming, as long as OpenUI renders only registered components.
- Copy, within `DESIGN.md`'s voice rules.
