# Plan 4b: the console goes live (runs, Take over, chat, Tracklist, live Trust, live demo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarik can start an agent run from Chat or from the Tracklist screen, watch it step by step, stop it with Take over, and see what the sandbox tried to reach on Trust. Judges get the same, live, from a separate demo sandbox with limits and a scripted fallback.

**Architecture:** A new host program, `apps/relay`, sits next to the bridge on the VM. It is the only thing that talks to Hermes. It watches Convex for work (a run to start, a stop request), starts Hermes runs over the local API, writes their events back into Convex, and copies the sandbox's network log into the activity table. The console never talks to Hermes. It reads and writes Convex as it does today, so Hermes stays on loopback (the VM's private-to-itself address). A second sandbox, `aircdemo`, serves the demo workspace through the same relay.

**Tech Stack:** TypeScript, Node 22 on the VM (nvm), `convex` JS client (`ConvexClient`, websocket subscriptions), Next.js App Router console, Vitest, Hermes Runs API (`POST /v1/runs {input}`, `GET /v1/runs/{id}/events` SSE, `POST /v1/runs/{id}/stop`, `GET /v1/runs/{id}`), `nemohermes <name> logs`.

**Spec:** `docs/superpowers/specs/2026-10-26-air-check-design.md` 5.3 (Take over), 5.6 (demo sandbox), 5.7 item 5 (live demo, caps, scripted labels), 6.2/6.3, 10, 11 (V2b, V11, V12); `design/README.md` rows Chat, Tracklist; mockups `design/mockups/render-chat-package.webp`, `Console.dc.html`; `docs/SPIKES.md` V2b, V3, V11, V12; Plan 3 execution notes rulings on `RunStep.label/sources` and `upcoming`; events fixture `packages/core/test/fixtures/hermes-run-events.ndjson`.

**Branch:** `plan-4b/console-live` from main `b79bf41`, in `~/Projects/air-check`.

**Tarik's calls (Oct 27):** relay via Convex; runs start from Chat **and** a Draft package button; the live demo sandbox is in this plan.

**Not in this plan:** the Telegram "package ready" card (spec 5.1, comes with Plan 5's ingest, when packages can become approvable), OpenUI-generated cards (with the Plan view), Resume after Take over (with show notes), the bridge's own service account (CodeRabbit item 9, its own decision).

## Global Constraints

- Hard Rule 1: no path from model output to approve or publish. The relay's Convex functions may write only `runs`, `messages` and `activity` rows. `apps/console/convex/hardRule1.test.ts` grows to pin that, and keeps every existing assertion.
- Hard Rule 2: the relay holds no Box, Drive, Dropbox or Mixcloud credential. It holds the Hermes gateway tokens and one `RELAY_TOKEN`. The console container holds neither.
- Hard Rule 7: nothing in Chat or the run prompts asks for on-air talk, scripts or social copy.
- Hard Rule 8: no telemetry. The relay logs to journald only: run id, event type, counts. Never message text or tool arguments.
- Hard Rule 9: demo rows never reach the publisher. The demo sandbox can only create `workspace: "demo"` packages.
- Hard Rule 11: no track start times anywhere.
- Hermes ports stay on `127.0.0.1`. Nothing new listens on a public or Docker-network address except the bridge, which already does.
- Secrets in `~/.aircheck/*.env` on the VM, mode 600. Tokens are 48 hex chars (`openssl rand -hex 24`), each one different. `MIN_TOKEN_LENGTH` (32) from `convex/agentSubmit.ts` applies to `RELAY_TOKEN`.
- Every relay-facing Convex function takes the token as an argument and checks it with the existing constant-time `tokenMatches`. A missing or short env token fails closed.
- Live chat deltas reach Convex at most every 500 ms per message (`DELTA_FLUSH_MS = 500`).
- Demo limits, my defaults, changeable by env var on Convex: `DEMO_RUNS_PER_SESSION = 5` per 10 minutes, `DEMO_LIVE_RUNS_PER_DAY = 40` (US Central day). `DEMO_LIVE=0` forces the scripted path.
- Every run row carries `source: "live" | "scripted"`; every card shows "Live · Nemotron" or "Sample · scripted".
- Before building or changing a screen, run the Impeccable skill against `PRODUCT.md` and `DESIGN.md`, with the mockups as reference (CLAUDE.md).
- VM changes that restart Hermes or create a sandbox are announced to Tarik first, with what goes down and for how long.
- Docs use the Follow Along voice; decisions use the CLAUDE.md format with "What actually happened" blank.

## Review Focus

1. **The relay restarts in the middle of a run.** The run must not stay "running" forever or repeat steps. On start, the relay reconciles every run it marked `running`: `GET /v1/runs/{id}`, then replays the event stream if the run is still live, or writes its final status. Steps are keyed by Hermes event order, so a replayed event updates rather than duplicates (Task 4 test).
2. **Take over is pressed before the relay has started the run.** The run is still `queued`. It must end `cancelled` without Hermes ever starting it (Task 3 test).
3. **A judge tries to reach the real workspace from the demo.** The demo sandbox's submit token maps to `workspace: "demo"` only; its relay config writes only demo rows; it has no Telegram channel. Judges can also leave junk in the demo sandbox's memory, so the demo memory is reset nightly (Task 9).
4. **The daily cap runs out mid-conversation.** The next message must still get an answer: the scripted path, clearly labeled "Sample · scripted", never an error. The cap is counted in Convex code from run rows, not by the relay or the model (Task 3 test).
5. **A log line the parser doesn't recognise.** Skipped and counted, never a crash. The same denial seen twice after a relay restart is stored once, because each row's key is a hash of the raw line (Task 2 and Task 4 tests).

---

### Task 1: Spikes for the unknowns (VM, controller)

**Files:** `docs/SPIKES.md` (four new rows), `packages/core/test/fixtures/openshell-log-lines.txt` (new, real lines, no secrets).

- [ ] **Step 1: Runs API options.** On the VM, `GET :8642/v1/capabilities` and try `POST /v1/runs` with each of: `{input, session_id}`, `{input, conversation_history}`, `{input, instructions}`. Record which fields Hermes honours. **Branch:** if one carries prior turns, the chat prompt uses it; if none does, the chat prompt includes the last 10 turns as text (Task 2's `chatInput` covers both).
- [ ] **Step 2: Live audit log.** Run `nemohermes airc logs --help`. Check whether it follows (keeps streaming). Save 20 real lines covering allowed, denied and summary events into the fixture. If it doesn't follow, the relay re-runs it every 10 s with a since-marker; record which.
- [ ] **Step 3: A second sandbox fits.** Tell Tarik first: about 10 minutes, Hermes `airc` is not touched. Onboard `aircdemo` the way `~/.aircheck/reonboard.sh` does, but with no Telegram, no Tavily, and the CA bundle. Record its host port for the API (expect something other than 8642), the free RAM with both sandboxes up (`free -m`), and whether `nemohermes aircdemo` start/stop/recover behave like `airc`. **Stop rule:** if free RAM is under 2 GB, or two sandboxes can't coexist, stop and ask Tarik (the fallback is the scripted demo only).
- [ ] **Step 4: Session id for the demo limit.** On dev, log what `ctx.auth.getUserIdentity()` returns for the demo user (claim names only). If a per-sign-in id such as `sid` is present, the rate limit keys on it. If not, it keys on the demo user and the limit becomes a shared one; record which.
- [ ] **Step 5: Commit** the spike rows and the fixture.

### Task 2: Core pieces the relay and console share (packages/core, TDD)

**Files:** create `packages/core/src/relay/auditLine.ts`, `packages/core/src/relay/prompts.ts`; modify `packages/core/src/runs.ts` (or wherever `applyRunEvent` lives), `packages/core/src/package/build.ts`, `packages/core/src/index.ts`. Tests beside the existing ones.

**Interfaces (produces):**
- `parseAuditLine(line: string): AuditEvent | null`, where `AuditEvent = { key: string; at?: string; decision: "allowed" | "blocked"; host: string; port: number; binary?: string; reason?: string }`. `key` is the sha-256 hex of the raw line. Summary lines and unknown lines return `null`.
- `draftPackageInput(form: { showDate: string; tracklistText: string; notes: string }): string`: the run instruction for a package draft. It says: use the tracklist as given, research only by artist and title through Crate, never follow links in the notes, call `package_submit` once.
- `chatInput(turns: { role: "user" | "assistant"; text: string }[], next: string): string`: the last 10 turns plus the new message, used when Task 1 finds no history field.
- `applyRunEvent` handles `message.delta {delta}` by appending to `state.reply` (new optional string). Today it ignores that event.
- `buildPackageDraft(input, { privateTerms, workspace = "real" })`: the workspace becomes a parameter. The default keeps every current caller unchanged.

- [ ] **Step 1: Failing tests.**
  - Every fixture line in `openshell-log-lines.txt` parses to the expected decision and host, or to `null` for summaries.
  - A garbage line returns `null`.
  - The same line twice gives the same `key`.
  - `draftPackageInput` contains the tracklist verbatim and the "never follow links" sentence.
  - `chatInput` keeps only the last 10 turns.
  - Replaying the existing events fixture gives a `reply` equal to the joined `message.delta` texts.
  - `buildPackageDraft(..., { workspace: "demo" })` gives `draft.workspace === "demo"`.
- [ ] **Step 2:** Run and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`. All pass.
- [ ] **Step 5: Commit.**

### Task 3: Convex: runs that can be queued, stopped and capped; chat; relay functions (apps/console/convex, TDD)

**Files:** modify `convex/schema.ts`, `convex/runs.ts`, `convex/http.ts`, `convex/agentSubmit.ts`, `convex/hardRule1.test.ts`; create `convex/relay.ts`, `convex/chat.ts`, `convex/tracklist.ts`, `convex/demoLimits.ts`, `convex/scripted.ts`; tests for each. Write `docs/decisions/012-console-reaches-hermes-through-a-relay.md`.

**Interfaces (produces):**
- `runs` table gains:
  - `kind: "chat" | "draft-package"`, `source: "live" | "scripted"`
  - `status: "queued" | "running" | "stopping" | "completed" | "cancelled" | "failed"`
  - `input: string`, `stopRequested: boolean`, `hermesRunId?: string`, `conversationId?: string`, `sessionKey?: string`, `createdAt: number`
  - a `by_status` index
  - Existing seeded rows get defaults in the seed.
- `conversations` table `{ workspace, title, createdAt }`; `messages` table `{ workspace, conversationId, role, text, runId?, at }`.
- User functions (signed in, workspace from `actorOf`):
  - `chat.send({ conversationId?, text }) → { conversationId, runId }`
  - `tracklist.draft({ showDate, tracklistText, notes }) → { runId }`
  - `runs.requestStop({ runId })`
  - `chat.list`, `chat.messages({ conversationId })`
  - The existing `runs.get` returns the new fields.
- Relay functions, each taking `token: string`:
  - `relay.pending` (query): queued runs, plus running runs with `stopRequested`
  - `relay.started({ runId, hermesRunId })`
  - `relay.events({ runId, events: {event, data, t}[] })`: applies `applyRunEvent` in order and writes the reply delta onto the run's assistant message
  - `relay.finished({ runId, status })`
  - `relay.activity({ workspace, events: AuditEvent[] })`: inserts `kind: "network"` rows, skipping keys already stored
- The agent submit route maps `AGENT_SUBMIT_TOKEN → "real"` and `DEMO_AGENT_SUBMIT_TOKEN → "demo"`, and passes `workspace` to `buildPackageDraft`.

- [ ] **Step 1: Failing tests.**
  - `chat.send` creates one user message, one assistant message and one `queued` live run.
  - A demo actor over `DEMO_RUNS_PER_SESSION` gets a `RATE_LIMITED` ConvexError.
  - A demo actor with `DEMO_LIVE=0`, or past `DEMO_LIVE_RUNS_PER_DAY`, gets a `scripted` run that `scripted.ts` plays from the stored scripted events with `ctx.scheduler.runAfter`. It never reaches `relay.pending`.
  - `requestStop` on a `queued` run gives `cancelled`; on a `running` run it gives `stopping` with `stopRequested`.
  - A different workspace's run gives null or a not-found error.
  - Relay functions fail closed: wrong, missing or short token (env unset or under 32 chars) throws and writes nothing.
  - `relay.events` with the same event twice leaves the same step count.
  - `relay.activity` with a repeated key inserts once.
  - The submit route with the demo token creates a `demo` package; with the real token, a `real` one.
  - `hardRule1.test.ts`: `relay.ts`, `chat.ts`, `scripted.ts` and `tracklist.ts` import nothing from `packages.ts` decide/publish paths, and never call `internal.packages.decide`. The route list adds no route.
- [ ] **Step 2:** Run and see them fail.
- [ ] **Step 3: Implement.** Scripted events start as the existing fixture. Task 9 replaces them with a recorded demo run. `npx convex dev --once` from `apps/console` after adding functions.
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`.
- [ ] **Step 5:** Write decision 012: relay via Convex, against the console calling Hermes directly. Tarik's call. Gave up: token-by-token chat streaming (chunks every 500 ms instead).
- [ ] **Step 6: Commit.**

### Task 4: The relay program (apps/relay, TDD)

**Files:**
- `apps/relay/src/` with `main.ts` (wiring), `hermes.ts` (runs client), `convex.ts` (thin wrapper), `audit.ts` (log follower), `config.ts`
- Tests with a fake Hermes HTTP server, as `apps/bridge` does
- `apps/relay/package.json`, plus addition to the root vitest projects and typecheck
- `deploy/relay/aircheck-relay.service`, `deploy/relay/relay.env.example`

**Interfaces (consumes):** Task 3 relay functions; Task 2 `parseAuditLine`, `draftPackageInput`, `chatInput`.

**Behaviour:**
- Config lists sandboxes: `[{ name: "airc", workspace: "real", port: 8642, tokenEnv: "AIRC_GATEWAY_TOKEN" }, { name: "aircdemo", workspace: "demo", port: <Task 1>, tokenEnv: "AIRCDEMO_GATEWAY_TOKEN" }]`. A sandbox whose token env is empty is skipped, so Task 8 runs with the real sandbox only.
- Subscribes to `relay.pending`. For each queued run of a configured workspace:
  - It sends `POST /v1/runs {input}` to that sandbox, adding a history field if Task 1 found one.
  - Then `relay.started`, then it streams events into `relay.events` in batches, at most every 500 ms.
  - Then `relay.finished` with the terminal status.
- For `stopRequested` it sends `POST /v1/runs/{id}/stop`.
- At most 2 live runs at once per sandbox; the rest wait queued.
- On start, it reconciles its `running` runs (Review Focus 1).
- It follows `nemohermes <name> logs` per sandbox and sends parsed events to `relay.activity` with that sandbox's workspace.
- Logs only `run=<id> event=<type> n=<count>`.

- [ ] **Step 1: Failing tests.**
  - A queued run reaches the fake Hermes and its events arrive in order.
  - A stop request reaches `/stop`.
  - The fake Hermes dropping the stream mid-run leads to reconcile via `GET /v1/runs/{id}`.
  - A restart with a `running` run reconciles it.
  - A third queued run waits until one of two finishes.
  - Unknown log lines are counted, not thrown.
  - The token never appears in a log line.
- [ ] **Step 2:** Run and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`.
- [ ] **Step 5: Commit.**

### Task 5: Run page and Take over (console, TDD)

**Files:** `src/app/(console)/runs/[id]/page.tsx`, `src/components/RunProgressCard.tsx` and its test.

**Behaviour (spec 5.3, with the spec's own fallback):**
- **Take over** calls `runs.requestStop`. The card shows "Stopping at the next step…" and then "Stopped. You have it from here."
- For a `draft-package` run, "Edit and draft again" opens the Tracklist screen with that run's inputs. Ruling: before `package_submit` there is no draft to hand over. What exists is the inputs and the research steps, and the package itself is edited on its own page.
- **Resume** is not built. It needs the block-level show notes (P1).
- The `source` label is on the card. The existing "connects to the agent in a later build" note goes away.

- [ ] **Step 1: Failing tests.**
  - Take over on a running run calls the mutation once and shows the stopping state.
  - A cancelled `draft-package` run shows "Edit and draft again", linking to `/tracklist?from=<runId>`.
  - Scripted runs show "Sample · scripted".
- [ ] **Steps 2–4:** Run and see them fail, implement, run `pnpm test`.
- [ ] **Step 5: Commit.**

### Task 6: Tracklist screen with the Draft package button (console, Impeccable, TDD)

**Files:** `src/app/(console)/tracklist/page.tsx`, `src/components/TracklistEditor.tsx` with its test, nav entry in `Shell.tsx` (the Tracklist item stops pointing at `/soon`).

**Behaviour:** this follows the `design/README.md` Tracklist row:
- An editable textarea that parses live with core `parseTracklist`. The `HOUR 1`/`HOUR 2` markers and the closing tracks are shown, and unparseable lines are flagged.
- Also: show date, and a notes box for the private notes, labelled as private.
- **Draft package** is disabled until both hours have tracks and there are no flagged lines. It calls `tracklist.draft` and goes to `/runs/<runId>`.
- `?from=<runId>` pre-fills the form from that run's inputs.
- Ruling: the hour audio ids stay out of this form. The package lands as `preparing_audio`, and Plan 5's ingest supplies the files. Cost: a package drafted here can't be approved until Plan 5.

- [ ] **Step 1:** Run the Impeccable skill on this screen against `PRODUCT.md`, `DESIGN.md` and the mockups. Record the decisions in the task report.
- [ ] **Step 2: Failing tests.**
  - Live parse marks the two closing tracks of the golden tracklist.
  - The button is disabled with only hour 1, and disabled with a flagged line.
  - Submit calls `tracklist.draft` with the three fields.
  - `?from=` pre-fills.
  - The page works at 375 px width with no horizontal scroll (Playwright, the existing e2e setup).
- [ ] **Steps 3–5:** Implement, run tests and e2e, commit.

### Task 7: Chat screen (console, Impeccable, TDD)

**Files:** `src/app/(console)/chat/page.tsx`, `src/components/ChatThread.tsx`, `src/components/ChatPackageCard.tsx` with their tests, nav entry.

**Behaviour:** this follows the chat mockup:
- Conversations list with "New conversation", then messages.
- The assistant message fills in as `reply` grows. While its run works, a compact progress line ("Searching MusicBrainz · step 2") links to `/runs/<id>`.
- When the run created a package, a **package card rendered by our code from the Convex package row** shows: title, tags, track and closing counts, flags, and "Review full package" linking to `/packages/<id>`.
- The header shows the Sandbox chip (Task 8).
- Rate-limit and cap states read plainly: "Demo limit reached: answers are sample replies until tomorrow."
- Ruling: this card is not OpenUI-generated. Generated cards arrive with the Plan view (P1), where the model has real composition choices. A package card has fixed fields, so code renders it and no model output reaches a button. Cost: the mockup's "GENERATED UI" label is absent here.

- [ ] **Step 1:** Run Impeccable on this screen with the chat render.
- [ ] **Step 2: Failing tests.**
  - Sending clears the box and shows the user message at once.
  - A growing `reply` re-renders.
  - A run with a package shows the card with counts taken from the row.
  - `RATE_LIMITED` shows the plain message.
  - Width is 375 px with no horizontal scroll.
- [ ] **Steps 3–5:** Implement, run tests and e2e, commit.

### Task 8: Live Trust and the sandbox chip, then go live for the real workspace (console + VM, controller)

**Files:** `src/app/(console)/trust/page.tsx` (network rows show host, port and allowed/blocked from relay data; nothing new in the schema). Modify `convex/schema.ts` with a `sandboxStatus` row per workspace `{ phase, allowedHosts: number, at }` and a `relay.status` function. The relay sends the status every 5 minutes from `nemohermes <name> status`. Also `docs/DEPLOY.md` (relay section), `docs/ARCHITECTURE.md` 3.0.

- [ ] **Step 1: Failing tests.**
  - Trust lists a `blocked` network row with its host.
  - The chip reads "Sandbox on · N hosts allowed" from the row, or "Sandbox status unknown" when the row is older than 15 minutes.
- [ ] **Step 2:** Implement, then run `pnpm test`.
- [ ] **Step 3: VM.** Tell Tarik first: Hermes is not restarted.
  - Deploy the relay the way the bridge is deployed (bundle, tarball, `~/aircheck-relay`, systemd unit).
  - Create `~/.aircheck/relay.env` (600) with `RELAY_TOKEN` and the `airc` gateway token.
  - Set `RELAY_TOKEN` on **dev** Convex first.
- [ ] **Step 4: Live proof on dev.**
  1. Draft from Tracklist with the 10-9-26 tracklist: the run page fills step by step.
  2. Take over on a second run: it ends cancelled, and Hermes's `GET /v1/runs/{id}` agrees.
  3. A chat message gets a reply.
  4. The sandbox tries a blocked host, and the row shows on Trust within 15 s.
  5. Record the evidence.
- [ ] **Step 5: Prod.** Run `RELAY_TOKEN` and `npx convex deploy -y` on `clever-deer-759`, switch `relay.env` to prod, restart the relay. **Stop rule:** prod gets no test runs without Tarik's say-so.
- [ ] **Step 6:** Add the relay to the watchdog's probes (a `/healthz`-style check of the relay process state), then commit.

### Task 9: The live demo sandbox (VM + bridge + Convex, controller)

**Files:**
- `apps/bridge/src/server.ts`: adds `/aircheck-demo/mcp`, with its own token, calling Convex with `DEMO_AGENT_SUBMIT_TOKEN`; tests.
- `deploy/hermes/aircheck-hermes.service`: adds start/recover/stop for `aircdemo`.
- `deploy/hermes/watchdog.sh`: adds an `aircdemo` probe.
- A nightly memory reset for `aircdemo`: a systemd timer running `deploy/hermes/reset-demo.sh`.
- Docs: `docs/DEPLOY.md`, `docs/decisions/013-live-demo-sandbox.md`, `docs/SPIKES.md`, `docs/LEARNING-LOG.md`.

- [ ] **Step 1: Bridge, TDD.** The demo endpoint lists `package_submit`. Its call reaches Convex with the demo token. The real token is refused on the demo path, and the demo token on the real one.
- [ ] **Step 2: VM.** Tell Tarik first.
  - Register `crate` (same deny list) and `aircheck` → `/aircheck-demo/mcp` with `nemohermes aircdemo mcp add`.
  - Put the `aircdemo` gateway token in `relay.env`.
  - Install the updated boot unit, watchdog and reset timer.
- [ ] **Step 3: Live proof on dev**, signed in as the demo user.
  1. A chat message gets a live reply labelled "Live · Nemotron".
  2. A draft creates a `demo` package and no `real` row.
  3. The sixth run in 10 minutes is refused plainly.
  4. With `DEMO_LIVE=0`, the reply is labelled "Sample · scripted".
  5. Record one live demo run of the 10-2-26 draft and store its events as the scripted events (replacing Task 3's placeholder).
- [ ] **Step 4: Reboot test** of both sandboxes. Tell Tarik first: about 1 minute down. Then prod deploy, as in Task 8 step 5.
- [ ] **Step 5:** Write decision 013: a live demo with limits, against scripted-only. Tarik's call. Gave up: RAM headroom and a second sandbox to keep alive. Then docs, then commit.
