# Plan 3: Console foundation and P0 screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in Air Check console (Next.js + Clerk + Convex) with the approved Today, package page, Trust and live-progress screens, where Approve runs the Plan 1 approval gate inside one Convex transaction and the judge demo workspace works end to end on sample data.

**Architecture:** `apps/console` is a Next.js 16 App Router app. Convex is the source of truth. The `packages.decide` mutation derives the actor from the Clerk identity and runs `ApprovalGate` from `@aircheck/core` against a store backed by `ctx.db`. A Convex mutation is a serializable transaction, so compare-and-swap is atomic, and the activity row is written in the same transaction. The agent and publisher reach packages only through internal functions (Plans 4 and 5). Pages read through Convex queries filtered by the caller's workspace.

**Tech Stack:** Next.js 16.4, React 19.3, Tailwind CSS 4.3 (`@tailwindcss/postcss`), Clerk (`@clerk/nextjs` 7.9), Convex 1.48 + `convex-test` 0.0.65, Vitest, Playwright 1.64 + `@clerk/testing` 2.2. Versions are from `npm view` on Oct 26, 2026; pin them in `package.json`.

**Spec:** `docs/superpowers/specs/2026-10-26-air-check-design.md` (sections 5.1, 5.3, 5.6, 5.8, 6.2, **6.3 approved layouts**, 7.1, 7.3). Visual references: `design/mockups/render-*.webp`, and the approved mocks with their HTML source in `.impeccable/mocks/decision/` (`one-screen`, `trust-timeline`, `progress`). The HTML files show the exact markup and CSS values the screens must match.

**Later plans:** Plan 4 is the Crate bridge plus the agent tools that call `packages.submit` and stream Hermes runs into `runs`. Plan 5 is ingest, the media job and the publisher (`claimForPublish`/`recordResult` callers). Then the digest, Plan view, show notes and radar. Deployment of the console to the VM, behind HTTPS on 443, is its own short plan after this one.

## Global Constraints

- Monorepo: `apps/console` joins `pnpm-workspace.yaml` (`packages/*`, `apps/*`). The console imports `@aircheck/core` as `workspace:*`.
- Design tokens are copied exactly from `DESIGN.md` into Tailwind v4 `@theme` in `apps/console/src/app/globals.css`. Fonts come from `next/font/google`: Instrument Serif (titles only), DM Sans (body and buttons), DM Mono (labels, times, hosts). No other face. No gradients, shadows at rest, or emoji.
- No eyebrow label above a heading on new surfaces. Status is shown with pills (spec 6.3).
- Every status is a word plus a color. Touch targets are 44px or more. No horizontal page scroll at 375px.
- **Hard Rule 8:** `NEXT_TELEMETRY_DISABLED=1` and `CLERK_TELEMETRY_DISABLED=1` are set in `apps/console/.env.example`, in the CI env and in the Docker env. No analytics script of any kind.
- **Hard Rule 1:** no code path from model output or the agent to `packages.decide`. Only the signed-in user's Convex identity decides. The agent and publisher use `internal.*` functions only.
- **Hard Rule 9:** demo-workspace packages never publish. A demo identity can read and decide only demo-workspace records, and a real identity sees only real records.
- Sample data carries a visible "Sample" tag (DESIGN.md Sample Honesty Rule).
- Secrets live only in `apps/console/.env.local` (git-ignored) and the Convex dashboard. They are never committed.
- Convex: Air Check gets its **own** Convex project (`air-check`). Never point the console at `precise-fish-444`.

## Review Focus

1. **A long title on a 375px phone** (a 99-character title, 5 tags). No horizontal scroll, the title wraps, and Approve, Edit and Skip stay 44px or taller and visible. → Task 14 test `package page fits a 375px phone`.
2. **The package changed after the page was opened.** Approve shows "This package changed. Open the latest version." and offers a reload. It must not fail silently. → Task 5 test `decide with stale fingerprint returns PACKAGE_CHANGED`, plus Task 8 test `stale approve shows reload message`.
3. **The session expired when the Telegram link is tapped.** Sign-in returns to the same `/packages/<id>`. → Task 6 test `protected route redirects with redirect_url`.
4. **The demo identity opens a real package URL.** It gets the plain not-found state, with no title or status leaked. → Task 5 test `demo identity cannot read a real package`.
5. **Double-tapping Approve.** The button disables while the request is pending, and only one `approved` activity row is written. → Task 5 test `two concurrent decides write one approved activity row`, plus Task 8 test `approve button disables while pending`.

---

## File structure

```
apps/console/
  package.json  next.config.ts  postcss.config.mjs  tsconfig.json  .env.example  vitest.config.ts  playwright.config.ts
  convex/
    schema.ts            packages, activity, verifications, releases, runs
    auth.config.ts       Clerk issuer (CLERK_JWT_ISSUER_DOMAIN, applicationID "convex")
    packageStore.ts      convexPackageStore(ctx): PackageStore (+ activity writer)
    packages.ts          get, listAwaiting (queries); decide (mutation); submit, claimForPublish, recordResult, attachAudio (internal)
    activity.ts          list (query: workspace timeline, optional kind filter)
    today.ts             summary (query)
    runs.ts              get (query)
    seed.ts              seedDemo (internal mutation)
    *.test.ts            convex-test suites
  src/
    proxy.ts             clerkMiddleware: everything protected except /sign-in, /demo
    app/layout.tsx  globals.css  providers.tsx (Clerk + Convex + Player)
    app/sign-in/[[...sign-in]]/page.tsx   app/demo/route.ts
    app/(console)/layout.tsx  (shell)   today/page.tsx   packages/[id]/page.tsx   trust/page.tsx   runs/[id]/page.tsx
    components/  Shell.tsx  Pill.tsx  PackageDecision.tsx  PlayerBar.tsx  PlayerProvider.tsx  Timeline.tsx  RunProgressCard.tsx
  public/demo/sample-hour.mp3   (synthetic tone, labeled sample)
  e2e/console.spec.ts
packages/core/src/
  package/fingerprint.ts   (now async, Web Crypto)
  identity.ts              actorFromIdentity
  runs.ts                  RunState reducer for Hermes run events
```

---

### Task 1: Make the fingerprint portable, and record the hour-1 length

The fingerprint must run inside Convex functions, which have no `node:crypto`. Web Crypto (`globalThis.crypto.subtle`) runs in Node 24, Convex and browsers.

**Files:** Modify `packages/core/src/package/fingerprint.ts`, `src/package/approval.ts` (the `AudioRef` type and the `draft.audio` shape gain `hour1DurationSec?`), and `test/approval.test.ts`.

**Interfaces:**
- Produces: `export async function fingerprint(p: PackageDraft): Promise<string>`, the same canonical JSON and the same SHA-256 hex, now computed with `crypto.subtle.digest("SHA-256", ...)`. `AudioRef` gains an optional `hour1DurationSec?: number` that is stored on the draft but **not** fingerprinted (it is derived from the MP3). Every `ApprovalGate` method keeps its signature; they already return promises.

- [ ] **Step 1:** Add a test `fingerprint is identical to the node:crypto value`. It hashes the golden draft and compares against `createHash("sha256")` of the same canonical JSON, computed in the test only. Also add `hour-1 length does not change the fingerprint`. Then update the existing approval tests to `await fingerprint(...)`.
- [ ] **Step 2:** Run `pnpm test approval`. Expected: FAIL. (`fingerprint` returns a string, not a promise, and `hour1DurationSec` is rejected by the type check.)
- [ ] **Step 3:** Implement as described above. In `ApprovalGate`, replace each synchronous `fingerprint(x)` call with `await fingerprint(x)`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: 67/67 pass.
- [ ] **Step 5:** Commit with `refactor(core): Web Crypto fingerprint so the gate runs inside Convex`.

### Task 2: Turn a Clerk identity into an Actor

**Files:** Create `packages/core/src/identity.ts` and `test/identity.test.ts`.

**Interfaces:**
- Consumes: `Actor` (Plan 1).
- Produces:
  ```ts
  export interface IdentityClaims { subject: string; email?: string; emailVerified?: boolean; role?: string }
  export function actorFromIdentity(id: IdentityClaims | null): Actor | null
  ```
  Rules: `null` gives `null`. `role === "demo"` gives `{kind:"demo", userId: subject}`. A verified email ending (case-insensitive) in `@radiomilwaukee.org` gives `{kind:"human", userId: subject, email}`. Anything else gives `null`. The function never returns `{kind:"agent"}`, because agents never hold a Clerk identity.

- [ ] **Step 1: Write the failing tests.** Cover each of these: `null`; demo role; verified Radio Milwaukee email; an unverified Radio Milwaukee email gives `null`; `x@notradiomilwaukee.org` gives `null`; upper-case `Tarik@RadioMilwaukee.org` gives human; demo role takes priority even if the email is from the domain.
- [ ] **Step 2:** Run `pnpm test identity`. Expected: FAIL.
- [ ] **Step 3:** Implement and export it from `src/index.ts`.
- [ ] **Step 4:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): actorFromIdentity`.

### Task 3: Reduce Hermes run events into progress state

Uses the event shapes recorded in spike V12 (`docs/SPIKES.md`).

**Files:** Create `packages/core/src/runs.ts`, `test/runs.test.ts` and `test/fixtures/v12-events.json`. The fixture holds the 5 events V12 printed, reconstructed as `{event, data}` objects: two `tool.started`/`tool.completed` pairs with `tool: "terminal"`, then `run.cancelled`.

**Interfaces:**
- Produces:
  ```ts
  export type StepStatus = "working" | "done" | "error";
  export interface RunStep { id: string; tool: string; preview: string; status: StepStatus; startedAt: number; durationSec?: number }
  export interface RunState { runId: string; status: "running" | "stopping" | "completed" | "cancelled" | "failed" | "interrupted"; steps: RunStep[]; interim?: string; output?: string }
  export function initialRun(runId: string): RunState
  export function applyRunEvent(state: RunState, event: string, data: Record<string, unknown>, at: number): RunState  // pure; returns a new object
  ```
  Behavior:
  - `tool.started` appends a `working` step. Its `preview` comes from the argument-preview field, cut to 80 characters.
  - `tool.completed` marks the oldest `working` step with the same tool as `done`, or `error` when the event's error flag is true, and sets `durationSec`.
  - `message.interim` sets `interim`.
  - `run.completed` sets `completed` and `output`. `run.cancelled`, `run.failed` and `run.interrupted` set their status.
  - Unknown events return the state unchanged.

- [ ] **Step 1: Write the failing tests.** `V12 replay yields 2 done steps and cancelled`. `completed before started is ignored`. `error flag marks step error`. `unknown event is a no-op` (assert reference equality). `state is not mutated` (freeze the input with `Object.freeze` and assert no throw).
- [ ] **Step 2:** Run `pnpm test runs`. Expected: FAIL.
- [ ] **Step 3:** Implement the reducer and export it.
- [ ] **Step 4:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(core): Hermes run event reducer`.

### Task 4: Console scaffold, design tokens and CI

**Files:** Create `apps/console/*` (Next.js app, `globals.css` with `@theme` tokens, `layout.tsx` with the three `next/font/google` faces, `.env.example`). Modify `pnpm-workspace.yaml`, the root `package.json` scripts (`typecheck` runs `tsc` for core and console, and `build` runs `pnpm --filter console build`), and `.github/workflows/ci.yml` (adds `pnpm build` with `NEXT_TELEMETRY_DISABLED=1`).

**Interfaces:**
- Produces: Tailwind utilities named after the DESIGN.md tokens (`bg-paper`, `bg-sidebar`, `bg-surface`, `text-ink`, `text-ink-soft`, `text-muted`, `bg-signal`, `bg-signal-soft`, `bg-caution-bg`, `text-caution-text`, `bg-problem-bg`, `text-problem-text`, `border-line`, `font-serif`, `font-sans`, `font-mono`, `rounded-control` 10px, `rounded-card` 14px), and `apps/console/.env.example` listing these by name: `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, `AIRCHECK_DEMO_USER_ID`, `NEXT_TELEMETRY_DISABLED=1`, `CLERK_TELEMETRY_DISABLED=1`.

- [ ] **Step 1 (Tarik, manual, about 10 min):**
  1. Create a Clerk application "Air Check" with Google and email sign-in, restricted to the `radiomilwaukee.org` domain.
  2. Create a demo user and set its public metadata to `{"role":"demo"}`.
  3. Add a JWT template named `convex` with claims `{"email":"{{user.primary_email_address}}","email_verified":"{{user.email_verified}}","role":"{{user.public_metadata.role}}"}`.
  4. Create a Convex project `air-check` by running `! cd ~/Projects/air-check/apps/console && npx convex dev --once` (it opens a browser to log in).
  5. Paste the keys into `apps/console/.env.local` (never into chat).

  Claude verifies by name only that every `.env.example` key has a value.
- [ ] **Step 2: Write the failing test** `apps/console/src/telemetry.test.ts`. It reads `.env.example` and `.github/workflows/ci.yml` and asserts both contain `NEXT_TELEMETRY_DISABLED=1` and `CLERK_TELEMETRY_DISABLED=1`. It also greps `apps/console/src` and asserts no `gtag`, `posthog`, `segment`, `plausible`, `@vercel/analytics` or `@next/third-parties` import.
- [ ] **Step 3:** Run `pnpm test telemetry`. Expected: FAIL (the files don't exist yet).
- [ ] **Step 4:** Scaffold the app as listed. `next.config.ts` sets `transpilePackages: ["@aircheck/core"]`. The home route `/` redirects to `/today`.
- [ ] **Step 5:** Run `pnpm test && pnpm typecheck && NEXT_TELEMETRY_DISABLED=1 pnpm build`. Expected: all pass, and the build succeeds.
- [ ] **Step 6:** Commit with `feat(console): Next.js scaffold with DESIGN.md tokens, telemetry off`.

### Task 5: Convex schema, the package store and the decide mutation

**Files:** Create `convex/schema.ts`, `auth.config.ts`, `packageStore.ts`, `packages.ts`, `activity.ts` and `packages.test.ts`.

**Interfaces:**
- Consumes: `ApprovalGate`, `PackageStore`, `PackageRecord`, `PackageDraft`, `actorFromIdentity`, `GateError` (core).
- Produces:
  - Table `packages`: `{ packageId: string, workspace: "real"|"demo", status, draft: any, fingerprint?: string, decidedBy?: string, decidedAt?: string, result?: {url?, error?} }`, with indexes `by_packageId`, `by_workspace_status`.
  - Table `activity`: `{ workspace, at: number, kind: "waiting"|"action"|"network", title: string, destination?: string, result: "needs_you"|"done"|"allowed"|"blocked", reason?: string, packageId?: string }`, with index `by_workspace_at`.
  - `convexPackageStore(ctx: MutationCtx, workspace?: "real"|"demo"): PackageStore`. `compareAndSwap` reads and patches inside the mutation, which is atomic.
  - The gate's `onTransition` inserts an `activity` row with `kind: "action"` in the **same** mutation. Titles: `Approved package <title>`, `Skipped package <title>`, `Package ready for your approval` (status `awaiting_review`, kind `waiting`). This fixes the Plan 1 deferred minor about losing the activity row.
  - `api.packages.get({ packageId })` returns a `PackageRecord` or `null`. It returns `null` when the caller's actor is `null`, or when `record.draft.workspace` doesn't match the actor's workspace (`demo` ↔ `demo`, `human` ↔ `real`).
  - `api.packages.listAwaiting()` lists `awaiting_review` records in the caller's workspace.
  - `api.packages.decide({ packageId, fingerprint, decision })` returns `{ ok: true, record } | { ok: false, code: GateErrorCode, message: string }`. The actor comes from `ctx.auth.getUserIdentity()` mapped through `actorFromIdentity`. Gate errors are returned, never thrown, so the UI can show them.
  - `internal.packages.submit({ draft })`, `internal.packages.attachAudio({ packageId, audio })`, `internal.packages.claimForPublish({ packageId })` and `internal.packages.recordResult({ packageId, result })` are thin wrappers over the gate. They exist for Plans 4 and 5. Only deploy-key callers can reach internal functions.
  - `api.activity.list({ kind?: "waiting"|"action"|"network"|"blocked" })` returns the newest 200 rows for the caller's workspace. `blocked` filters on `result: "blocked"`.

- [ ] **Step 1: Write the failing tests** in `convex/packages.test.ts`, using `convexTest(schema, modules)` with `t.withIdentity({subject, email, emailVerified, role})`:
  ```ts
  test("anonymous cannot decide", ...)                       // no identity -> { ok:false, code:"FORBIDDEN" }
  test("outside-domain identity cannot decide", ...)          // x@gmail.com -> FORBIDDEN
  test("real identity approves a real package", ...)          // submit via internal, attachAudio, decide -> ok, status approved, 1 activity row "Approved package ..."
  test("decide with stale fingerprint returns PACKAGE_CHANGED", ...)
  test("demo identity cannot read a real package", ...)       // get -> null; decide -> FORBIDDEN
  test("demo identity can approve a demo package", ...)
  test("two concurrent decides write one approved activity row", ...) // Promise.all two decides -> one 'approved' row
  test("activity.list blocked filter returns only blocked rows", ...)
  ```
- [ ] **Step 2:** Run `pnpm --filter console test convex`. Expected: FAIL (the modules are missing).
- [ ] **Step 3:** Implement the schema, store and functions above. Run `npx convex codegen` to produce `convex/_generated`, and commit `_generated`.
- [ ] **Step 4:** Run `pnpm --filter console test`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat(console): Convex schema, package store and decide mutation`.

### Task 6: Sign-in, route protection and the one-click demo door

**Files:** Create `src/proxy.ts`, `src/app/providers.tsx`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/demo/route.ts` and `src/proxy.test.ts`.

**Interfaces:**
- `proxy.ts`: `clerkMiddleware` with `createRouteMatcher(["/sign-in(.*)", "/demo"])` as the public routes. Every other route calls `await auth.protect()`. That redirects to `/sign-in?redirect_url=<original path>`.
- `providers.tsx`: `ClerkProvider` (telemetry off), then `ConvexProviderWithClerk` (`useAuth` from `@clerk/nextjs`), then `PlayerProvider` (Task 9).
- Sign-in page, matching `Main.dc.html` and spec 6.2: a dark ink panel with the wordmark, the promise line and the three trust statements, copied verbatim from the mock; Clerk `<SignIn />` styled with the tokens; and a separate "Here to review the hackathon entry? Open the demo workspace" link to `/demo`.
- `GET /demo` creates a Clerk sign-in token for `AIRCHECK_DEMO_USER_ID`, valid for 60 seconds, and redirects to `/sign-in?__clerk_ticket=<token>` with `redirect_url=/today`. Rate limit: 10 a minute per IP, in memory **(Claude's call)**. Confirm the current Clerk backend method name for sign-in tokens with ctx7 before writing it.

- [ ] **Step 1: Write the failing test** `protected route redirects with redirect_url`. Using Next's `unstable_doesMiddlewareMatch`, or a request built with `NextRequest`, call the exported proxy with no session for `/packages/abc`. Assert a redirect to `/sign-in` whose `redirect_url` is `/packages/abc`. Also add `/demo is public` and `/sign-in is public`.
- [ ] **Step 2:** Run `pnpm --filter console test proxy`. Expected: FAIL.
- [ ] **Step 3:** Implement the files above.
- [ ] **Step 4:** Run the tests, then manually: `pnpm --filter console dev`, open `/demo`, and confirm you land on `/today` signed in as demo.
- [ ] **Step 5:** Commit with `feat(console): Clerk sign-in, protected routes, one-click demo door`.

### Task 7: App shell

Match the Today render (`design/mockups/render-today.webp`) and spec 6.1.

**Files:** Create `src/app/(console)/layout.tsx`, `src/components/Shell.tsx`, `src/components/Pill.tsx` and `src/components/Shell.test.tsx` (Vitest + Testing Library + jsdom).

**Interfaces:**
- `Shell({ title, children, workspace })`:
  - Sidebar nav, in exactly this order: Today, Chat, Plan, Tracklist, Episodes, Release radar, Trust, Skills and memory. Square markers; the active one is green and carries `aria-current="page"`.
  - Header: serif title, plus the pills `Sandbox on` (green dot) and `4 destinations allowed`. The 4 comes from the constant `ALLOWED_DESTINATIONS` in `src/lib/sandbox.ts` (Nebius Token Factory, api.telegram.org, api.tavily.com, pypi.org, taken from the V1 policy). Plan 4 replaces the constant with the live policy.
  - In the demo workspace, the sidebar footer shows "Demo workspace · Sample data. Publishing to Mixcloud is switched off."
  - Under 900px the sidebar collapses into a top bar with a menu button. Nav items not built yet (Chat, Plan, Tracklist, Episodes, Release radar, Skills and memory) link to a plain "Coming in a later build" page, never a 404.
- `Pill({ tone: "ready"|"caution"|"problem"|"neutral", children })`.

- [ ] **Step 1: Write the failing tests.** `nav order matches spec`. `active item has aria-current`. `demo footer shows only in demo workspace`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): app shell and pills`.

### Task 8: The package page (approved "One-screen decision")

Match `.impeccable/mocks/decision/one-screen.webp` and `html/one-screen.html`.

**Files:** Create `src/app/(console)/packages/[id]/page.tsx`, `src/components/PackageDecision.tsx` and `PackageDecision.test.tsx`.

**Interfaces:**
- Consumes: `api.packages.get`, `api.packages.decide` (Task 5), and `PlayerBar` plus `usePlayer` (Task 9).
- `PackageDecision({ record })` renders these parts:
  1. A date label, `Show of <Month D, YYYY>`, plus a status pill: `Draft · N flags` (caution) / `Approved · queued` (ready) / `Skipped` (neutral) / `Published` with a link (ready) / `Upload uncertain` (problem, for `outcome_unknown`).
  2. A single card with the serif title, tag pills, and three counts: tracks, closing tracks, description characters (code points).
  3. The numbered flags, then "See description, tracklist and sources". That opens an inline section (no modal) with the full description and a character count, the tracklist with a `closing track` chip in the neutral chip color, and the alternates.
  4. The player bar for the episode.
  5. The line "This will be public on Mixcloud".
  6. Stacked Approve (primary), Edit and Skip.
- While the decide request is pending, all three buttons are disabled and Approve reads "Approving…".
- On `PACKAGE_CHANGED`, show an inline problem notice: "This package changed. Open the latest version." with a Reload button. On `NOT_READY`, show "The audio is still being prepared."
- Flags come from `record.draft.flags: string[]`. Add that optional field to `PackageDraft` in core, excluded from the fingerprint, with a one-line core test.
- Edit opens the chat for that package. That's Plan 4; for now it links to "Coming in a later build".
- When `get` returns `null`, show the same "Package not found" state for missing, foreign-workspace and not-signed-in cases.

- [ ] **Step 1: Write the failing tests.** `renders title, 3 counts and numbered flags`. `closing-track chip uses the neutral chip class`. `approve button disables while pending`, using a deferred promise mock of the mutation. `stale approve shows reload message`, where the mutation resolves to `{ok:false, code:"PACKAGE_CHANGED"}`. `null record shows not found and no title`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): package page, one-screen decision`.

### Task 9: Persistent player

**Files:** Create `src/components/PlayerProvider.tsx`, `PlayerBar.tsx`, `PlayerBar.test.tsx` and `public/demo/sample-hour.mp3`. Generate the MP3 with ffmpeg: a 20-second, two-tone synthetic sine, 128 kbps, with an ID3 comment "Air Check demo sample, synthetic". Use 10 seconds per "hour", so Jump to hour 2 is testable.

**Interfaces:**
- `PlayerProvider` owns one `<audio>` element, rendered once inside `providers.tsx`, so playback survives navigation.
- `usePlayer(): { track: PlayerTrack | null; playing: boolean; positionSec: number; load(t: PlayerTrack): void; toggle(): void; seek(sec: number): void; jumpToHour2(): void }`.
- `interface PlayerTrack { src: string; title: string; durationSec: number; hour2AtSec?: number }`. `jumpToHour2` seeks to `hour2AtSec` and is a no-op without it.
- `PlayerBar({ track })` matches the mock's player: play/pause, title, `mm:ss / h:mm:ss` in mono, a progress line with a tick at the hour-2 point, and a "Jump to hour 2" button. The space bar toggles playback, except while typing in an input.
- Track source rules: in the demo workspace, `/demo/sample-hour.mp3` with `hour2AtSec: 10`. In the real workspace it is `null` for now, so the bar shows "Audio preview arrives with the media job". The real stream route comes in Plan 5.

- [ ] **Step 1: Write the failing tests.** `jump to hour 2 seeks to hour2AtSec`. `jump is disabled without hour2AtSec`. `space toggles play but not inside an input`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): persistent player with jump to hour 2`.

### Task 10: Today

Match `render-today.webp`.

**Files:** Create `convex/today.ts`, `today.test.ts` and `src/app/(console)/today/page.tsx`. Add the tables `verifications: { workspace, claim: string, status: "conflict"|"could-not-verify"|"confirmed", show?: string }` and `releases: { workspace, artist, title, label?, type?: "album"|"single"|"ep", releasedOn?: string, playedNote?: string }`.

**Interfaces:**
- `api.today.summary()` returns `{ awaiting: {packageId, title, tracks, flags}[], openClaims: {claim, status}[], releases: {count, labels, items: (first 2)}, blockedSince: number, blockedLatest?: {title, destination} }` for the caller's workspace. The window is since 6:00 pm the previous day, in America/Chicago. Code computes every count; nothing is estimated.
- The page has a left column (Ready to approve, linking to `/packages/<id>`; Claims that failed verification; New Bandcamp releases) and a right column (the blocked card, linking to `/trust?filter=blocked`; the Telegram preview bubble in the `surface-quiet` token, per spec 6.1). The "Sample" tag shows in the demo workspace.

- [ ] **Step 1: Write the failing tests.** `summary counts awaiting packages in caller workspace only`. `blockedSince counts blocked rows since 18:00 America/Chicago yesterday`, using a fixed clock with one row before and one after the cutoff.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): Today digest`.

### Task 11: Trust (approved "One timeline")

Match `trust-timeline.webp` and `html/trust-timeline.html`.

**Files:** Create `src/app/(console)/trust/page.tsx`, `src/components/Timeline.tsx` and `Timeline.test.tsx`.

**Interfaces:**
- Consumes: `api.activity.list` (Task 5).
- Filter chips: All, Waiting for you, Agent actions, Network, Blocked. Each shows its count. The selected chip is ink-filled. The filter lives in the `?filter=` query string, so Today's link to `/trust?filter=blocked` works. The default is `all` **(the Blocked default for demo stays undecided, spec 6.3)**.
- Table columns: Time (mono, `HH:mm:ss` in America/Chicago), Kind (mono label), What happened, Where (mono host or "—"), Result (pill: Needs you, Done, Allowed, or Blocked with the reason under it). Blocked rows get `#fbefec` tinted backgrounds, kept as a token in globals.css.
- Under 900px, the table scrolls inside its own box, never the page.

- [ ] **Step 1: Write the failing tests.** `blocked rows show reason and tinted row class`. `filter query string selects chip and rows`. `counts per chip match rows`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): Trust timeline`.

### Task 12: Live-progress card with Take over

Match `progress.webp` and `html/progress.html`.

**Files:** Create `convex/runs.ts` (table `runs: { workspace, runId, title, state: any /* RunState */, updatedAt }`, plus the query `api.runs.get({ runId })`), `src/components/RunProgressCard.tsx`, `RunProgressCard.test.tsx` and `src/app/(console)/runs/[id]/page.tsx`.

**Interfaces:**
- Consumes: `RunState` and `RunStep` (Task 3).
- `RunProgressCard({ title, state, totals, onTakeOver })` renders:
  - A progress bar and `N of M tracks · K closing tracks skipped`, with `totals: { tracks: number; closingSkipped: number }` from the caller.
  - One row per step, with its position label, preview, source chips and status word (Done / Working with a pulse dot / Next / Skipped / Error).
  - A `[verify]` chip in the caution color whenever a step preview contains `[verify]`.
  - A **Take over** button with the copy "Stops after this track and opens the draft for you to edit. The agent won't overwrite anything you change."
  - While `state.status` is `stopping`, the button reads "Stopping after this track…" and is disabled.
  - When the state is `cancelled`, the card shows "Stopped. Your draft is open." and the progress bar freezes.
- `onTakeOver` is a prop. Plan 4 wires it to Hermes `POST /v1/runs/{id}/stop`; Plan 3 passes a no-op in the demo.
- Honour `prefers-reduced-motion`: no pulse animation.

- [ ] **Step 1: Write the failing tests.** `renders done, working and skipped rows from V12 replay state`, using the Task 3 fixture through `applyRunEvent`. `stopping disables take over`. `cancelled shows stopped message`. `verify chip appears for [verify] previews`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): live-progress card with take over`.

### Task 13: Demo workspace seed

**Files:** Create `convex/seed.ts` and `seed.test.ts`. Add a root script `seed:demo` (`npx convex run seed:seedDemo`).

**Interfaces:**
- `internal.seed.seedDemo()` is idempotent: it deletes and re-inserts the demo rows only, never real ones. It inserts:
  - The golden 10-2-26 package as `workspace: "demo"`, from the Plan 1 fixture values, with the two flags from fixture section 6 and an attached demo MP3 hash.
  - Activity rows from the spike evidence, the same nine rows as the Trust mock, all labeled sample through the workspace.
  - Two verifications (ALA.NI release date: conflict; Silvan Strauss project credit: could-not-verify).
  - Two releases with bracketed placeholder text, per DESIGN.md.
  - One run (`runId: "demo-run-1"`) built from the V12 fixture plus the show-notes rows in the progress mock.

- [ ] **Step 1: Write the failing tests.** `seedDemo is idempotent` (run twice, same counts). `seedDemo never touches real rows`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): demo workspace seed`.

### Task 14: End-to-end demo flow at phone width

**Files:** Create `apps/console/playwright.config.ts` (projects: `iPhone 13` device and `Desktop Chrome`; a webServer running `pnpm dev`) and `e2e/console.spec.ts`. The flow uses `@clerk/testing/playwright` (`clerkSetup`, `setupClerkTestingToken`) with the Clerk demo user.

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  test("package page fits a 375px phone", ...)    // iPhone project, demo package with its 99-char title: document.documentElement.scrollWidth <= 375; Approve/Edit/Skip boxes >= 44px tall and in view after scrolling
  test("demo approve flow", ...)                   // /demo -> Today -> Review package -> Approve -> pill reads "Approved · queued"; Trust shows "Approved package" row
  test("today blocked card links to blocked filter", ...)
  test("player jump to hour 2", ...)               // play, click Jump to hour 2, currentTime >= 10
  ```
- [ ] **Step 2:** Run `pnpm --filter console exec playwright test`. Expected: FAIL until the screens are wired, then PASS. If Tasks 6 to 13 already pass, the first run passes too. Record that, and prove the size test can fail by temporarily setting `min-width: 420px` on the card, then reverting.
- [ ] **Step 3:** Run `pnpm test && pnpm typecheck && pnpm build`. Expected: all pass.
- [ ] **Step 4:** Run `/Users/tarikmoody/.claude/skills/impeccable/scripts/impeccable detect --json apps/console/src` once. Fix the mechanical findings and list the rest for the reviewer.
- [ ] **Step 5:** Commit with `test(console): end-to-end demo flow at phone width`.
