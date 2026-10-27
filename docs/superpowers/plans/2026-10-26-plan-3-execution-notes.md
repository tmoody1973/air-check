# Plan 3 execution notes (ledger)

The controller's ledger from the subagent-driven run of `2026-10-26-plan-3-console.md`, kept because it holds every ruling made during the build and every deferred review note. Later plans (Plan 4, Plan 5, the deploy plan) should read the "minor (deferred)" and "Ruling" lines before touching the same code.


Spec: docs/superpowers/specs/2026-10-26-air-check-design.md (approved). Branch: plan-3/console. Start HEAD f400bf1. 65/65 tests at start.

## Pre-flight scan

| Rows | Produces / consumes | Finding |
|---|---|---|
| T1 self | edits fingerprint.ts, approval.ts; AudioRef + draft.audio gain hour1DurationSec | draft.audio type lives in package/mixcloud.ts, not in the file list. Ruling below. Fingerprint uses explicit field list, so the new field is excluded naturally. 65+2=67 consistent. |
| T2 self | identity.ts | consistent |
| T3 self | runs.ts + V12 fixture | consistent |
| T4 self | scaffold, CI adds pnpm build | Root vitest include is packages/*/test only; telemetry test lives in apps/console/src. CI has no secrets, so the build must not need them. Rulings below. |
| T4→T5 | T5 runs `npx convex codegen`, needs Convex project from T4 manual step | dependency on Tarik's manual step (keys). |
| T5 self | schema comment lists 5 tables; T10/T12 add 3 of them | Ruling: each task adds its own tables. |
| T5 self | onTransition titles named for awaiting_review/approved/skipped only | Ruling below. |
| T6→T9 | providers.tsx wraps PlayerProvider (T9) | T9 comes after T6. Ruling: order. |
| T8→T9 | PackageDecision consumes PlayerBar/usePlayer (T9) | T9 after T8. Ruling: run T9 before T8. |
| T1/T8 | both add optional draft fields excluded from fingerprint | consistent (explicit field list). |
| T8 self | date label "Show of <Month D, YYYY>" vs approved mock "Show of Oct 2, 2026" | Ruling below. |
| T5→T11, T10→T11 | activity.list rows + /trust?filter=blocked | consistent |
| T3→T12 | StepStatus working/done/error vs card statuses Next/Skipped | Ruling below. |
| T12→T13 | run demo-run-1 from V12 fixture + show-notes rows of progress mock | needs the T12 display-row shape. |
| T13 self | "two flags from fixture section 6" — section 6 has 5 items | Ruling below. |
| T13 self | "attached demo MP3 hash" — Convex can't read public/ | Ruling below. |
| T13→T14 | T14 expects "demo package with its 99-char title"; golden title is ~84 chars | Ruling below. |
| T14 self | needs live Clerk + Convex, demo user | dependency on T4 manual step. |

## Rulings
- Ruling: T1 may edit packages/core/src/package/mixcloud.ts to add `hour1DurationSec?` to `PackageDraft.audio` — the type lives there — cost if wrong: none, one-line type change.
- Ruling: root `pnpm test` runs both core and console tests (vitest projects or equivalent); `pnpm --filter console test` runs console only — keeps CI one command — cost if wrong: small config rework.
- Ruling: CI `pnpm build` must succeed with no secrets in env (routes dynamic / no build-time key requirement) — CI has no secrets and must not get them — cost if wrong: a CI secret config step later.
- Ruling: execution order 1,2,3,4,5,6,7,9,8,10,11,12,13,14. T6 providers.tsx wraps Clerk + Convex only; T9 adds PlayerProvider to it — T8 and T6 consume T9 — cost if wrong: none.
- Ruling: activity rows are written only for the three transitions the plan names (awaiting_review → kind waiting/result needs_you; approved, skipped → kind action/result done). Other transitions write nothing until Plan 5 — plan names no titles for them — cost: Trust misses submit/publish rows until Plan 5.
- Ruling: T8 date label follows the approved mock: short month, "Show of Oct 2, 2026" — spec 6.3 approved the mock — cost: trivial copy change.
- Ruling: T12 RunProgressCard takes an optional display-only `upcoming` list (rows with status "next" | "skipped") from the caller for Next/Skipped rows; the core reducer stays working/done/error — the mock needs those rows and the reducer only sees Hermes events — cost: one extra prop.
- Ruling: T13 demo flags are the two texts in the approved mock, verbatim: "Spellings taken from your Paper notes (Lý Qua Dub, Quiñones, Gutiérrez)." and "Left out: the pre-air verify list and one personal detail." — the mock is the approved source — cost: copy change.
- Ruling: T13 stores the sample MP3's sha256 as a constant in seed.ts, with a test that the constant matches public/demo/sample-hour.mp3 — Convex functions can't read the file — cost: none.
- Ruling: T13 also seeds a second demo package `demo-long-title` (99-char title, 5 tags, sample) for Review Focus #1; T14's phone test uses it — golden title is ~84 chars — cost: one extra sample package visible to judges.

## Tasks
- Ruling: T4 manual step follows current Clerk docs (clerk-docs _partials/convex-initial-setup.mdx, fetched 2026-10-26): activate the Convex integration in the dashboard instead of a hand-made `convex` JWT template; add claims email/email_verified/role on the Sessions page (session token). Env var name stays CLERK_JWT_ISSUER_DOMAIN (value = Clerk Frontend API URL), and it must also be set in the Convex deployment env — plan step predates the Clerk change — cost if wrong: re-do one dashboard step.
- Task 1: dispatched (base f400bf1, sonnet)
- Task 1: implementer DONE 9b24bcc (68/68, 3 tests vs 2 listed); review dispatched (sonnet)
- Task 1: minor (deferred): approval.ts:156 leaves explicit `hour1DurationSec: undefined` key on revise; harmless now, conditional spread if Convex validators reject undefined
- Task 1: complete (commits f400bf1..9b24bcc, review clean; controller re-ran 68/68 + typecheck)
- Task 2: dispatched (base 9b24bcc, haiku)
- Ruling: commit co-author lines name the model that actually wrote the commit (e.g. Haiku 5.5) — accurate attribution — cost: none
- Task 2: ⚠️ resolved: role claim source = Clerk public_metadata (server/dashboard-only, not user-editable; unsafe_metadata is the user-editable one). Carry to T5: claims must map public_metadata.role, and the Convex caller must coerce string claims ("true") for email_verified.
- Task 2: minor (deferred): no tests pinning emailVerified undefined / missing email / unknown role "admin" → null (code handles all)
- Task 2: complete (commits 9b24bcc..6647b4c, review clean)
- Task 3: dispatched (base 6647b4c, sonnet)
- Task 3: implementer DONE_WITH_CONCERNS a1ef544 (80/80); guessed Hermes fields error/duration/text|message/output beyond V12's tool+preview; review dispatched (sonnet). [Tarik asked: VM airc-vm stopped 20:25, state STOPPED]
- Task 3: parked — ⚠️ Hermes field names error/duration/text|message/output unverified (V12 evidences only tool + preview) — Ruling: keep reducer as is; Plan 4 verifies against a live Hermes stream before wiring (VM stopped, T12 only renders fixture/demo state) — cost if wrong: errors show "done" and interim/output stay empty until Plan 4 fixes the names.
- Task 3: minor (deferred): runs.ts:79 status cast via slice(4); missing interim/output field overwrites prior value with ""; runs.ts:54 comment understates unverified fields; test gaps (message.interim, run.failed/interrupted, oldest-first with 2 working steps, step id uniqueness)
- Task 3: complete (commits 6647b4c..a1ef544, review clean, 1 parked)
- Ruling: T4 implementer skips Step 1 (Tarik's manual Clerk/Convex step; controller tracks it) and installs pinned `convex` + `@clerk/nextjs` deps so Tarik's `npx convex dev --once` works; wiring stays in T5/T6 — cost: none.
- Task 4: dispatched (base a1ef544, sonnet)
- Task 4: implementer DONE bac5629 (83/83, build w/o secrets OK); review dispatched (sonnet). Tarik doing Convex+keys now.
- Task 4: ⚠️ resolved: controller ran no-secrets build (no .env.local present) → success; 83/83. Docker env part of Hard Rule 8 → deployment plan.
- Task 4: minor (deferred): telemetry regex bans bare word "segment" (fragile for radio copy; narrow to import/script patterns); CI flag check is substring-only; no --radius-pill token (rounded-full covers); CI flags inline on build step only
- Task 4: complete (commits a1ef544..bac5629, review clean)
- Task 5: dispatched (base bac5629, sonnet implementer; opus reviewer planned — Hard Rules 1/9 live here)
- Task 5: implementer DONE_WITH_CONCERNS 37da366 (91/91); codegen run pushed auth providers:[] to own dev deployment optimistic-lobster-654 (air-check, not precise-fish) — harmless; review dispatched (opus)
- Task 5: review Needs fixes: Important — real identity can decide demo package (Hard Rule 9 one-way). ⚠️ confirmed gap: decided-by-other returns ok:true (silent). Ruling: Convex decide returns PACKAGE_CHANGED when resulting status ≠ requested decision's status; same decision twice stays ok — Review Focus 2 forbids silent failure; core unchanged — cost: one more code path in decide.
- Ruling: promote minor "no structural Hard Rule 1 test" into fix round 1 — CLAUDE.md requires a failing test if a path appears — cost: one test.
- Ruling: Convex-CLI files in apps/console (CLAUDE.md, AGENTS.md, .agents/, .claude/, skills-lock.json) kept locally, git-ignored, not deleted — vendor AI guidance, created by Tarik's convex dev run; unvetted third-party skills stay out of the public repo — cost: none.
- Task 5: minor (deferred): submit draft v.any() no boundary validation (Plan 4 entry); schema status v.string() not literal union; gate.ts:38 reads record before checking spec; Workspace type declared twice + pointless re-exports + void lint workaround; packages.test imports core test helpers by relative path; activity blocked filter only within newest 200; TDD order (impl before RED)
- Task 5: fix round 1 dispatched (resume implementer; FIX_BASE 37da366)
- Tarik: Clerk app + demo user + claims + Convex project (optimistic-lobster-654) done; .env.local 8/8 keys present (lengths checked, no values printed); controller set CLERK_JWT_ISSUER_DOMAIN on Convex dev deployment (20:38). Tarik reports keys tested working.
- Task 5: fix round 1/5 (4 addressed, 0 open; commits 37da366..c45cb21)
- Task 5: minor (deferred): hardRule1 guard globs ./*.ts only — subdirectory modules not covered (use ./**/*.ts minus _generated); no dedicated demo→real decide test (same !== path); get checks draft.workspace while decide checks doc.workspace (equal by construction)
- Task 5: complete (commits bac5629..c45cb21, review clean after 1 fix round)
- Task 6: dispatched (base c45cb21, sonnet)
- Task 6: implementer DONE_WITH_CONCERNS 21a3820,3d7afbf (99/99); mock eyebrow line omitted per global constraint; review dispatched (opus)
- Controller live check (ego-browser, dev :3100): /demo → /today signed in, Clerk user role=demo (publicMetadata). Session token has aud=convex but NO email/email_verified/role claims → actorFromIdentity would return null (demo & staff FORBIDDEN). Asked Tarik to save Sessions → Customize session token claims. Re-check after.
- Controller re-check 20:47: claims fixed — token has aud=convex, role=demo, email_verified=true (boolean), email @example.com. Demo identity maps to demo actor.
- Task 6: ⚠️ resolved: ticket consumption verified live by controller (/demo → /today signed in as demo); no-keys build re-run by controller on 3d7afbf in temp worktree → success (/demo, /sign-in dynamic). Review Focus 3 browser pass (expired session → /packages/<id>) → Task 14.
- Task 6: minor (deferred): XFF-keyed limiter bypassable + Map never evicts (key on proxy-set header at deploy; evict empty keys); /demo absolute Location from request.url may carry internal host behind proxy (use relative Location — check at deploy); Clerk default redirect allowlist includes *.accounts.dev on dev (set allowedRedirectOrigins); /demo createSignInToken has no try/catch (generic 500); static-extension paths bypass proxy matcher (comment for later export routes); appearance vars untyped, Core 3 renamed colorText etc. (type with satisfies / visual check); hardcoded hex duplicates tokens in sign-in page; Convex URL fallback 127.0.0.1:0 silent at runtime; /demo route handler untested (429/503/userId+60s)
- Task 6: complete (commits c45cb21..3d7afbf, review clean)
- Task 7: dispatched (base 3d7afbf, sonnet)
- Controller 20:49: Tarik hit 'No auth provider found (no providers configured)' — leftover providers:[] from T5 codegen. Pushed real functions+auth config to own dev deployment (npx convex dev --once). Verified: Convex query packages:listAwaiting with demo Clerk token → HTTP 200 success (array 0). Note: Convex AI files out of date (npx convex ai-files update) — local-only, ignored.
- Task 7: implementer DONE 987782c (103/103); followed brief '4 destinations' over render '5 hosts'; omitted render's Recent list + avatar block (sample, not in brief); review dispatched (sonnet)
- Task 7: ⚠️ resolved: controller screenshot (demo, /soon/plan, 1512px) shows tokens render (sidebar, pills, caution footer), active green square, no h-scroll. 375px check → Task 14.
- Task 7: minor (deferred): demo footer lacks "·" separator; on mobile the demo footer is hidden inside the collapsed menu (Sample honesty weaker on phones — consider Sample pill in top bar); "New conversation" link not in brief; no tests for mobile toggle/Pill tones
- Task 7: complete (commits 3d7afbf..987782c, review clean)
- Task 9: dispatched before Task 8 per ordering ruling (base 987782c, sonnet)
- Task 9: implementer DONE 412a6b7 (109/109); sample-hour.mp3 sha256 5e07fc83b02bc5a38645f21ba7093fe8b7190087f4221ab21338427bce9ac106 (controller-verified) → T13 constant; T8 must call trackFor(workspace,title) from src/lib/track.ts; review dispatched (sonnet)
- Task 9: ⚠️ ID3/duration checked by controller with ffprobe (below in session); real-browser playback → Task 14 e2e "player jump to hour 2".
- Task 9: minor (deferred): setState calls inside setTrack updater (impure under StrictMode); load effect keys only on src (title change ignored); durationSec 0 → NaN% width; progress bar not seekable/aria-hidden; missing tests (Space on focused button, two bars, src switch resets position); jump before metadata may clamp
- Task 9: complete (commits 987782c..412a6b7, review clean)
- Ruling: T8 adds optional `alternates?: string[]` to core PackageDraft next to `flags?` (both excluded from fingerprint) — spec 6.2 "title with alternates" and the brief's inline section need a source — cost: one optional field.
- Ruling: T8 expand label reads "See description and tracklist" (not "…and sources") until provenance data exists (Plan 4) — showing "sources" with none rendered would be untrue — cost: copy deviates from mock.
- Ruling: T8 in the demo workspace replaces "This will be public on Mixcloud" with the demo notice beside the buttons ("Demo workspace · Sample data. Publishing to Mixcloud is switched off.") and shows a "Sample" pill — spec 6.1 "demo notice sits beside the action buttons", Sample Honesty Rule, and the public line would be false in demo — cost: none.
- Task 8: dispatched (base 412a6b7, sonnet)
- Task 8: implementer DONE 1618019 (120/120); decide fn passed as prop; layout responsive max-w-xl with inline stacked 48px buttons vs mock's fixed 390px dock; review dispatched (sonnet)
- Ruling: Skip stays unavailable while preparing_audio — the gate decides only awaiting_review packages with a fingerprint (Plan 1 design) — cost: a host can't skip a package before its audio is joined.
- Task 8: review Needs fixes: Important — Skip enabled but silent no-op without fingerprint; live useQuery fingerprint makes PACKAGE_CHANGED unreachable and swaps content under the reader. ⚠️ Focus 4 confirmed tested in T5 ("demo identity cannot read a real package"); Hard Rule 9 server-side in gate.
- Ruling: pin the reviewed record as a snapshot; live divergence shows "This package changed…" + Reload; decide sends the snapshot fingerprint — Review Focus 2 — cost: one piece of state.
- Ruling: promote minor "buttons re-enable before status flips" into fix round 1 — Review Focus 5 — cost: small.
- Ruling: accept responsive max-w-xl column with inline stacked buttons instead of the mock's fixed 390px dock — the mock is a 390px phone frame; Focus 1 needs buttons visible after scrolling, which Task 14 tests — cost: desktop look differs from the phone mock.
- Task 8: minor (deferred): Edit link aria-disabled stays activatable while busy; no hint text for disabled Approve beyond fix; "failed" is default case (non-exhaustive switch); no 99-char/375px test (Task 14)
- Task 8: fix round 1 dispatched (resume implementer; FIX_BASE 1618019)
- Ruling: preparing_audio→awaiting_review shows the changed notice once (Reload) — the reviewed content really changed (audio attached) — cost: one extra tap.
- Task 8: fix round 1/5 (3 addressed, 0 open; commits 1618019..1e51eed); controller ran build + typecheck after fix (clean)
- Task 8: minor (deferred): server PACKAGE_CHANGED notice doesn't disable Approve/Skip (add notice?.code check — one line); Reload after server PACKAGE_CHANGED with unchanged live re-pins stale record briefly; changed notice only renders inside the deciding block (decided snapshot can freeze silently)
- Task 8: complete (commits 412a6b7..1e51eed, review clean after 1 fix round)
- Ruling: T10 releases count = all releases in the caller's workspace (no added-at timestamp exists; Plan 5 ingest adds one and windows them) — cost: "new releases" count isn't windowed to last night yet.
- Ruling: T10 summary returns null for a null actor; page shows an empty state — consistent with get/listAwaiting — cost: none.
- Task 10: dispatched (base 1e51eed, sonnet)
- Task 10: implementer DONE 0fdea89 (129/129); corrected controller's DST example (Nov 1 2026 is fall-back; cutoff Nov 1 18:00 CST); codegen pushed schema to own dev deployment; render deviations listed in report; review dispatched (sonnet)
- Task 10: ⚠️ resolved by controller: browser pass at 1512px after (a) clearing stale .next cache (useWorkspace "not a function" was HMR cache, not code) and (b) pushing functions — today:summary was never deployed (codegen doesn't push). Page renders all cards, Sample tag, surface-quiet bubble, no h-scroll. 375px → Task 14.
- Ruling: controller runs `npx convex dev --once` (own dev deployment) after every task that adds Convex functions — codegen alone doesn't deploy, and Tarik's browser hits the dev deployment — cost: none.
- Task 10: minor (deferred): release items return whole docs (project fields before email ingest feeds releases — Hard Rule 5); button "Review" vs render "Review package"; blocked count filters in memory (add by_workspace_result_at index if volume grows); Telegram card says "The link opens the signed-in console" but shows no link; v.any() draft casts could throw on malformed draft (guard)
- Task 10: complete (commits 1e51eed..0fdea89, review clean)
- Ruling: T11 fetches the newest 200 rows once (activity.list without kind), filters and counts client-side so chip counts match rows — cost: counts cover the newest 200 rows only.
- Task 11: dispatched (base 0fdea89, sonnet)
- Task 11: implementer DONE 859234a (133/133); Allowed pill neutral although mock shows green (ruling said follow mock if it differs); Sample tag above chips; review dispatched (sonnet)
- Task 11: review Needs fixes: Important — Allowed pill neutral vs mock's green (.res.ok); ruling (3) said follow mock; One Signal Rule permits green state pills. ⚠️ controller browser pass done (/trust?filter=blocked: chips, counts, Sample, no h-scroll); activity.list newest-200 is T5 (tested).
- Task 11: minor (deferred): th lacks border-b (cosmetic); 200-row cap on counts (accepted ruling)
- Task 11: fix round 1 dispatched (resume implementer; FIX_BASE 859234a; also parseFilter test)
- Task 11: fix round 1 implementer DONE ce32d6e (135/135); scoped re-review dispatched (haiku, one-line diff)
- Ruling (supersedes earlier T12 `upcoming` ruling detail): core RunStep gains optional display-only `label?: string` and `sources?: string[]` (reducer ignores them; callers that know the track set them — Plan 4, seed); card label = step.label ?? index+1; `upcoming?: {label, text, status: "next"|"skipped"}[]` prop for Next/Skipped rows, stored as optional `upcoming` on the runs row — the mock needs labels, source chips and Next/Skipped rows that Hermes events don't carry — cost: two optional core fields + one optional table field.
- Ruling: T12 omits the mock's "about 3 min left" estimate — no code-computed source (Hard Rule 10) — cost: copy differs from mock.
- Ruling: T12 Take over in Plan 3 shows an inline note "Take over connects to the agent in a later build." instead of a silent no-op — never fail silently — cost: none.
- Task 12: dispatched in parallel with T11 re-review (base ce32d6e, sonnet)
- Task 11: fix round 1/5 (1 addressed, 0 open; commits 859234a..ce32d6e)
- Task 11: complete (commits 0fdea89..ce32d6e, review clean after 1 fix round)
- Task 12: implementer DONE ab06829 (143/143); controller deployed to dev (runs:get callable); review dispatched (sonnet)
- Task 12: ⚠️ resolved: Convex push confirmed by controller (dev deployment "functions ready", runs:get callable). Visual check + possible duplicate title (Shell title + card h2) → after T13 seed.
- Task 12: minor (deferred): runs.get .unique() on by_runId throws if two workspaces share a runId (use .first() + workspace check); inline <style> per card instance; unvalidated `state as RunState` cast (guard in Plan 4); upcoming rows keyed by label
- Task 12: complete (commits ce32d6e..ab06829, review clean)
- Ruling: T13 golden draft data must come from one source: if core's test helper builds it from fixture files via fs (unusable inside Convex), seed.ts holds the values inline and a test asserts seed's draft equals the golden helper output (title, tags, description, 31 tracks, closing marks) — no drift — cost: data duplicated once, guarded by a test.
- Ruling: T13 inserts the demo package directly as awaiting_review with fingerprint from core `fingerprint()` (same function decide checks) plus a test that a demo identity can approve the seeded package via api.packages.decide — cost: none.
- Ruling: T13 activity timestamps are relative to seed time (keeping the mock's order/spacing) so Today's "since 6 pm" window always includes them — cost: times differ from the mock's literal clock values.
- Ruling: T13 demo-run-1 replays tool.started/tool.completed events (V12 event shapes) through applyRunEvent whose previews are the progress mock's show-notes rows, then adds labels/sources; it does not include V12's literal "terminal sleep" steps; status running; upcoming = H1.7 Next, H1.15 Skipped — a show-notes card with shell commands in it would mislead — cost: deviates from "built from the V12 fixture" literally.
- Task 13: dispatched (base ab06829, sonnet)
- Task 13: implementer DONE_WITH_CONCERNS dcaa912 (151/151); no pre-impl RED captured; tracks cast (reconciled tracks carry status); review dispatched (sonnet); controller deploying + seeding dev in parallel
- Task 13: ⚠️ resolved: Sample tag renders from workspace on Today, package page, Trust and run card (controller screenshots after seeding dev 21:19).
- Task 13: minor (deferred): activity offsets' first/last gaps differ from mock (0,15…298 vs 0,135…298); no-op `T` wrapper in seed.ts; demo-long-title shares audio hash/hour ids with golden package; no RED run captured before implementation
- Task 13: complete (commits ab06829..dcaa912, review clean)
- Controller: seeded dev deployment (pnpm seed:demo) → today:summary as demo shows 2 awaiting, 2 claims, 2 blocked; browser screenshots of Today, package, Trust, run all render, no h-scroll at 1512px.
- Task 12: REOPENED — controller found in browser: [verify] chip computed bg white (bg-surface beats bg-caution-bg; conflicting utilities on one element); test only asserted class presence. Also run title shown twice (minor, folded in). Fix round 1 dispatched (resume implementer; FIX_BASE dcaa912).
- Task 12: fix round 1 implementer DONE dc4d989 (151/151); controller measured chip bg #F6E7C8 / text #5A3E00, h1 "Live progress"; build OK; scoped re-review dispatched (haiku)
- Ruling: T14 signs in ONCE through /demo in a Playwright setup project and reuses storageState — the /demo limiter allows 10/min per IP and 4 tests × 2 projects would trip it — cost: none.
- Ruling: T14 global setup re-seeds the demo workspace (seed:seedDemo on the own dev deployment, demo rows only) so the approve test is repeatable — cost: each run resets demo data.
- Ruling: T14 e2e runs locally only, not in CI (needs Clerk/Convex secrets CI must not hold); vitest must not pick up e2e files — cost: e2e isn't gated by CI.
- Ruling: T14 adds one e2e for Review Focus 3: signed-out visit to /packages/demo-10-2-26 → /sign-in with redirect_url=/packages/demo-10-2-26 — cheap and it's a named Review Focus — cost: one test.
- Ruling: Today's button reads "Review" (spec 6.1 shortened copy); T14's approve flow clicks "Review" — cost: none.
- Task 14: dispatched (base dc4d989, sonnet)
- Task 12: fix round 1/5 (2 addressed, 0 open; commits dcaa912..dc4d989); Convex push concern already confirmed by controller
- Task 12: complete (commits ce32d6e..ab06829 + dcaa912..dc4d989, review clean after reopen + 1 fix round)
- Task 14: implementer DONE_WITH_CONCERNS 9a75e75 (e2e 8 pass + 3 project-guard skips; 151 unit); fail-proof 436>375; viewport set to 375 in phone test; NEXT_DIST_DIR optional distDir for second dev server; impeccable detect: 20 advisory off-ramp font sizes, none fixed; review dispatched (sonnet)
- Task 14: ⚠️ resolved: CONVEX_DEPLOYMENT is dev:optimistic-lobster-654 (controller checked prefix earlier); seed wipes demo rows only.
- Task 14: minor (deferred): Today "Review" click not asserted to reach the right package before goto(GOLDEN); loose /play/i button selector; reuseExistingServer could reuse a plain server on 3200 without .next-e2e; add comment that seed:demo follows .env.local's deployment; hard-coded port 3200/120s
- Task 14: complete (commits dc4d989..9a75e75, review clean)
- Ruling: impeccable detect's 20 advisory off-ramp font sizes left for Tarik (design call, not a defect) — cost: type ramp not fully enforced yet.
- Controller re-ran e2e: 8 passed, 3 skipped (22.9s). Final whole-branch review dispatched (opus).
- Final review (opus): no Critical. Important: (I1) demo "Approved · queued" + demo notice vanishes after decide — misleading; (I2) demo degrades during judging (one shared golden package consumed; seeded activity ages out of the 18:00 window). Minors M1–M10 + triage table (all deferred minors CAN WAIT; T5 demo→real test resolved).
- Ruling: final fix wave includes I1, I2, M1 (hardRule1 glob ./**/*.ts + isHttp), M2 (demo decide on missing package → FORBIDDEN, no existence probe), M3 (pin snapshot only while deciding), M5 (Space shortcut only while a PlayerBar is mounted), M6 (player reloads when src OR title changes), M7 (one SampleTag component), M9 (signed-in outsider message), M10 (dead code) — cheap, and I1/I2/M5/M7 are what judges will see — cost: one larger fix diff.
- Ruling: I2 fix = Convex cron re-running internal.seed.seedDemo every hour — keeps the golden package approvable and activity inside the window for every judge; a judge mid-approval at the top of the hour gets the "This package changed" notice and reloads — cost: hourly demo-only writes on the deployment; a judge's approval lasts at most an hour.
- Ruling: deferred to later plans: M4 (progress card unreachable/odd totals — Plan 4 chat links runs), M8 (hard-coded header pills — Plan 4), all CAN WAIT triage items; deploy-plan must carry T6 limiter/Location/allowedRedirectOrigins/try-catch and I2 verification on the VM.
- Final fix wave dispatched (FIX_BASE 9a75e75, sonnet)
- Final fix wave: implementer DONE 4a51506 (159/159, e2e 8+3). Controller: deployed to dev incl. crons.ts (functions ready; first cron run not yet observed); browser approve on demo-10-2-26: 'Draft · 2 flags' → 'Approved · sample, not published', demo notice visible, Approve gone; re-seeded after. Scoped re-review dispatched (sonnet).
- Final fix wave: re-review — all 10 findings ADDRESSED, no new Critical/Important. Minor: post-approve reseed flips a decided demo view back to Draft without notice (cosmetic; demo can't publish); e2e doesn't assert demo notice after approval (unit test does).
- PLAN 3 COMPLETE: commits b26e813..4a51506; 159 unit, typecheck clean, build OK, e2e 8+3.
