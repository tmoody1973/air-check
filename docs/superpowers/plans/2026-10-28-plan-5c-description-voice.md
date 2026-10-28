# Plan 5c: descriptions in Tarik's voice, editable, and updatable after publishing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mixcloud descriptions read like Tarik's own: they name highlight tracks, say something about each artist, and carry facts only from a source. Tarik can edit a description before approving, ask the agent to rewrite it in Chat, and push a new description to a show that is already live, always through his approval.

**Why now (Oct 28):** the first real publish (`pkg-10-2-26`, live on Mixcloud) went out with a plain 237-character description. Three causes, all verified on the VM and in the code:
1. None of the eight `skills/rlr-*` station skills are installed in the agent (`nemohermes airc skill list`). Only Hermes's built-ins are.
2. The agent wrote its own skill on Oct 27, `mixcloud-package-submission` (`/sandbox/.hermes/skills/…/SKILL.md`), learned from failed retries. It says "keep total description under 100 characters", confusing the title limit with the description limit, and "start with 'Mixcloud package for show [date]'".
3. `checkDescription` (`packages/core/src/package/description.ts`) flags any description naming 3+ song titles as a pasted tracklist, so Tarik's own style ("corto.alto's smooth 'April'… Sampha's emotive 'Cumulus/Memory'… Yazmin Lacey's powerful 'Worlds Apart'") fails its own rule.

**Architecture:**
- The agent learns the voice from a rewritten `skills/rlr-description-safety/SKILL.md`, installed into both sandboxes with `nemohermes <sandbox> skill install`. Its worked examples are Tarik's real past Mixcloud descriptions (20 pulled from the public API on Oct 28, saved in the session scratchpad; the plan quotes the ones used).
- Facts about an artist (instrument, era, city, label, a notable collaboration) come only from Crate results the agent can name. The draft carries them as `descriptionSources: {claim, source}[]`, shown to Tarik on the package page and never published.
- Before approval: a human **Edit description** box on the package page, and an agent `package_revise` tool. Both re-fingerprint, so Tarik reviews the new text before Approve works.
- After publishing: a **description update** record (`descriptionUpdates` table). Tarik or the agent proposes; only a signed-in human approves; the publisher pushes it with Mixcloud's documented edit endpoint (`POST https://api.mixcloud.com/upload/<show key>/edit/`, description field only). Same Hard Rule 1 shape as publishing: no path from model output to Mixcloud without a human approve.

**Tech Stack:** TypeScript, Convex, Next.js, the existing bridge (MCP tools), the publisher service, NemoHermes CLI (`skill install|remove|list`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-air-check-design.md` 5.7 and 7.1, `CLAUDE.md` Hard Rules 1, 5, 6, 10, 12; `skills/rlr-description-safety`; Mixcloud developer docs (fetched 2026-10-27: edit endpoint, "`name`, `description` and `picture` are only changed when you include them").

**Branch:** `plan-5c/description` from `plan-5/live` (which holds the unmerged Task 7 deploy fixes).

## Tarik's decisions (Oct 28)

1. **Drop the opening line.** `checkDescription` no longer requires "Rhythm Lab Radio, week of …"; descriptions start straight in Tarik's voice, like his past posts (the date and show name are in the Mixcloud title). `descriptionFirstLine` and the `first-line` issue are removed, and the skill stops asking for it.
2. **Six or more named song titles = a pasted tracklist** (`TRACKLIST_THRESHOLD = 6`). Room for 2 to 3 highlight songs per hour.

## Global Constraints

- **Hard Rule 1.** Only a signed-in real human approves a new package or a description update. The publisher pushes only approved updates. `hardRule1.test.ts` grows to pin the new functions.
- **Hard Rule 6.** Under 1,000 characters (code points); no time-relative phrases (the existing list, plus "this week's show"); no unverified claims; no private details; no tracklist paste.
- **Hard Rule 10 spirit.** Every factual claim about an artist has a `descriptionSources` entry naming the Crate tool result it came from; adjectives and genre descriptions ("smooth", "Afrobeat pulse") are style, not claims. A claim with no source is left out and listed in the review flags.
- **Hard Rule 5.** No link-following; research by artist and title through Crate only.
- **Hard Rule 7.** No on-air talk or social copy.
- **Hard Rule 9.** Demo packages never push updates.
- **Hard Rule 8.** Logs carry ids, steps and timings only.
- **The agent's self-written skill is removed** from `airc` and recorded in `docs/FRICTION_LOG.md`; installing the station skill must not be undone by the agent's skill curator (check after a run that it did not re-create a description skill).

## Review Focus

1. **A model-written description reaching Mixcloud without a human approve** (update path). Test: an agent-proposed update is never pushed until a human approves; demo never pushes.
2. **An edit after approval.** Editing or revising a package that is already approved must not change what gets published without a new Approve. Test: edit only from `awaiting_review`; re-fingerprint.
3. **Pushing a description to the wrong show.** The show key comes from the package's own receipt URL, never from input. Test: the edit URL is built from `result.url`.
4. **An unsourced fact slipping into the public text.** Test the skill's examples against `checkDescription`; the package page shows every claim with its source.
5. **The agent re-learning the wrong rule.** After the live re-draft, `skill list` shows no agent-made description skill.

---

### Task 1: Description rules in code (packages/core, TDD)

**Files:** `packages/core/src/package/description.ts` and its tests; `packages/core/src/package/mixcloud.ts` (`PackageDraft` gains optional `descriptionSources`).

- `checkDescription` applies Tarik's decisions: no required opening line (remove `descriptionFirstLine`, the `first-line` issue and their callers/tests); `TRACKLIST_THRESHOLD = 6`; "this week's" / "this week's show" added to the time-relative list.
- `PackageDraft.descriptionSources?: { claim: string; source: string }[]` (each ≤ 300 chars, ≤ 12 entries). It is **not** sent to Mixcloud (`toMixcloudFields` unchanged; test pins it) and **is** part of the fingerprint only when present (a draft without it hashes exactly as today).
- Tests: Tarik's 10.24.25 description (minus "this week's") passes; the same text with 7 song titles fails as tracklist; "Dive into this week's show" fails as time-relative; fingerprint of a draft without sources is byte-identical to today.

### Task 2: The station skill, rewritten and installable (skills/, TDD on examples)

**Files:** `skills/rlr-description-safety/SKILL.md`; a test `packages/core/test/skillExamples.test.ts` that extracts every example description in the skill and runs `checkDescription` on it.

- Structure: no station opening line (decision 1); one short paragraph per hour; 4 to 8 artists per hour; under 1,000 characters.
- New: **voice.** Name 2 to 4 highlight tracks per hour as `Artist's "Song"`, with one vivid, accurate phrase each (style words are fine: "smooth", "emotive", "cinematic jazz-funk"). Bridge the hours ("Hour two…"). Close on what the set does as a whole.
- New: **artist context.** One factual detail for up to 3 artists, only from a Crate result (MusicBrainz, Discogs, Wikipedia, Bandcamp via Crate), each listed in `descriptionSources`. If Crate has nothing solid, use no fact for that artist.
- New: **three worked examples**: Tarik's 10.24.25, 10.3.25 and 7.4.25 descriptions, quoted verbatim, each followed by a note on what to keep (specific songs, one phrase per artist, hour bridge) and what the rules change ("this week's" → no time reference; no station opening line). Then one full example written for 10-2-26 from its tracklist, passing the checker.
- Keep every existing "Leave out" rule and the review-flags section.
- `skills/rlr-mixcloud-title-and-tags/SKILL.md`: unchanged, but installed alongside (Task 5).

### Task 3: Edit before approval: human box and agent revise tool (core, Convex, console, bridge; TDD)

- Core gate `editDescription(id, text, sources?, actor)`: human real-workspace only, `awaiting_review` only, runs `checkDescription` (any issue → BAD_INPUT with the issue list), re-fingerprints, stays `awaiting_review`, activity row. The existing `revise` path is reused for the agent.
- Convex: `packages.editDescription({packageId, description})` (signed-in real human); HTTP route `POST /agent/packages/revise` (token `AGENT_SUBMIT_TOKEN`, like submit) taking `{packageId, description, descriptionSources}` → `revise` with the current draft plus the new fields. For a `succeeded` package it creates a description update instead (Task 4). Any other status → 409 with a plain reason.
- Bridge: new MCP tool `package_revise` in `apps/bridge/src/aircheckTools.ts` beside `package_submit`, same token handling; it drafts, never approves (Hard Rule 1 comment + test).
- Console: an **Edit description** box on the package page while `awaiting_review`: live character count, the checker's issues in plain words before saving, Save → "Changed: review again". Shows `descriptionSources` under the description as "Sources (not published)". Impeccable first.
- Hard Rule 1 allowlist and source pins updated.

### Task 4: Update a live show's description (Convex, publisher, console; TDD)

- Table `descriptionUpdates`: `{packageId, description, descriptionSources?, status: "proposed"|"approved"|"pushing"|"pushed"|"failed", proposedBy: "agent"|"human", approvedBy?, approvedAt?, fingerprint, error?, pushedAt?}`; at most one open (`proposed`/`approved`/`pushing`) per package.
- Proposing: the human box on a `succeeded` package's page, or the agent's `package_revise` (Task 3). Both run `checkDescription`.
- Approving: `descriptionUpdates.approve({id, fingerprint})`, signed-in real human, real workspace only, from `proposed` only, fingerprint must match (so Tarik approves the text he saw).
- Publisher: each pass, claim one `approved` update (CAS to `pushing`), build the show key from the package's own `result.url` (path after `https://www.mixcloud.com`), `POST https://api.mixcloud.com/upload<key>edit/` multipart with **only** `description`, token from the token file. 2xx with `success: true` → `pushed` and the package's recorded description is updated; 4xx → `failed` with a short code; invalid token → `needs_reconnect` and back to `approved`. A description edit is idempotent, so a network error or 5xx goes back to `approved` and retries next pass (max 3 tries, then `failed`). Updates don't count toward the 3-a-day limit.
- Console on a `succeeded` package: "Update the description on Mixcloud" box, the proposed text beside the live text, **Approve update**, then "Updating on Mixcloud…" / "Updated <time>" / the failure reason with Retry (which re-proposes).
- Hard Rule 1 test: an agent-proposed update is never claimed until a human approves; demo packages can't create updates; the edit URL comes only from `result.url`.

### Task 5: Live on the VM (controller, with Tarik's go per step)

1. Deploy Convex, bridge, publisher, console (DEPLOY.md procedures).
2. `nemohermes airc skill remove mixcloud-package-submission`; install the station skills with a new `deploy/hermes/install-skills.sh` that, for each of `airc` and `aircdemo` and each of `rlr-description-safety` and `rlr-mixcloud-title-and-tags`, runs `skill remove` (ignore "not found") then `skill install` (NemoHermes refuses to replace a same-name skill), then `skill list`. Add a watchdog probe "Agent skills" that fails when `nemohermes airc skill list` lacks `rlr-description-safety`. Persistence (checked in the NemoHermes v0.0.137 docs on the VM, Oct 28): skills live in `/sandbox/.hermes/skills/<name>`; they survive stop/start and `rebuild` (which backs up and restores Hermes state files) but not destroy + re-onboard, so DEPLOY.md's re-onboard steps gain "run install-skills.sh".
3. In Chat: "Rewrite the description for pkg-10-2-26." The agent researches with Crate, calls `package_revise`, and a proposed update appears on the package page with its sources.
4. Tarik reads it, edits if he likes, and presses **Approve update**. Verify on the live Mixcloud page that only the description changed (title, tags, cover, tracklist untouched).
5. `skill list` again: no agent-made description skill came back.
6. Docs: `docs/SPIKES.md` (V5 answered by the live post: sections without times display like manual posts), `FRICTION_LOG.md` (the agent's self-taught wrong skill; MCP adapters unwired after restart; ReadWritePaths first start), `DEPLOY.md` (skills install, publisher section, description updates), decision 015 (description voice and sources, What actually happened blank), `LEARNING-LOG.md`.
