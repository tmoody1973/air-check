# Plan 3b execution notes (ledger)

The controller's ledger from the subagent-driven run of `2026-10-26-plan-3b-deploy-console.md`: every ruling, deferred review note and piece of live evidence from the deploy. Plan 4 starts with the Hermes items at the end.


Spec: docs/superpowers/specs/2026-10-26-air-check-design.md + docs/ARCHITECTURE.md 3.0 + docs/NEBIUS_SETUP.md. Branch deploy/console from main c2ae953; plan commit 713c4d9. Tarik confirmed: Clerk domain aircheck.rhythmlabradio.com, email-code sign-in first, subagent-driven.

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T0 (manual) → T4 | Clerk prod keys, DNS, Convex deploy key, VM start | T4/T5 blocked until T0 done; T1–T3 independent of it. |
| T1 self | clientIp reads x-real-ip only; demo route 503/relative Location/429 | consistent |
| T1 → T3 | limiter trusts x-real-ip ← Caddy header_up X-Real-IP {remote_host} | consistent; T3 test pins the Caddy side |
| T2 self | allowedRedirectOrigins + authorizedParties from NEXT_PUBLIC_APP_URL; build must still need no secrets | consistent |
| T2 → T3 | NEXT_PUBLIC_APP_URL build arg + env example | consistent |
| T3 self | standalone output keeps NEXT_DIST_DIR override; read_only + tmpfs for .next/cache | consistent; e2e dev server unaffected (standalone only on build) |
| T4 → T5 → T6 | prod deploy, live proof, runbook | consistent |
Scan clean.

## Tasks
- Task 1: dispatched (base 713c4d9, sonnet)
- Task 1: implementer DONE 57e6bed (168/168); review dispatched (sonnet). Tarik approved static public IP on airc-vm.
- Controller (Tarik-approved): airc-vm network interface public_ip_address set static:true (first attempt failed: needed --parent-id). VM still STOPPED; permanent IP assigned on next start.
- Task 1: ⚠️ carried to T3: Caddy must set X-Real-IP from peer (overwrite) and must not write access logs containing /sign-in?__clerk_ticket= (no access log, or log without query). Clerk middleware public routes unchanged (Plan 3 tested).
- Task 1: minor (deferred): no Cache-Control: no-store on the /demo 302; console.error spy not asserted token-free; x-real-ip not validated with net.isIP (only matters if console reachable directly — T3 forbids); O(n) scan ≤10k + test-only .size()
- Task 1: complete (commits 713c4d9..57e6bed, review clean)
- Task 2: dispatched (base 57e6bed, sonnet)
- VM started 21:59 at Tarik's request; RUNNING with static public IP (kept out of repo; told to Tarik for DNS).
- Task 2: implementer DONE 9ccd2b6 (172/172, no-secrets build OK); carry to T3: NEXT_PUBLIC_APP_URL is a build arg, bare origin, no trailing slash. Review dispatched (sonnet).
- Task 2: ⚠️ option names confirmed by typecheck against 7.9 + ctx7 (implementer); relative redirects unaffected (Clerk docs).
- Task 2: minor → folded into T3: NEXT_PUBLIC_APP_URL trailing slash would lock everyone out (exact match) — normalise with new URL(v).origin in one shared helper used by providers.tsx and proxy.ts, and say "bare origin" in env examples.
- Task 2: complete (commits 57e6bed..9ccd2b6, review clean)
- Ruling: Compose reads secrets via `--env-file ${HOME}/.aircheck/console.env` (interpolates build args) and `env_file: ${HOME}/.aircheck/console.env` (runtime); Caddy writes no access log (no `log` directive) so /sign-in?__clerk_ticket= never lands on disk — cost: no HTTP access log on the VM (Caddy error log still on).
- Task 3: dispatched (base 9ccd2b6, sonnet)
- DNS: aircheck A → static VM IP resolves on local, 8.8.8.8, 1.1.1.1 and GoDaddy authoritative (22:02). Clerk CNAMEs pending Tarik's Clerk prod instance.
- Task 3: implementer DONE_WITH_CONCERNS d46dda0 (186/186); local Docker daemon unavailable → controller validates image + compose on VM with fake placeholders; review dispatched (sonnet)
- Controller VM validation of d46dda0 (fake non-secret values, cleaned up after): image builds (38 s); compose config OK; only caddy publishes 80/443; console read_only, mem 768m, pids 256; container boots read-only as uid 1000 node; /sign-in 500 with fake Clerk key (expected; real keys in T4). Note: NemoClaw/Hermes (8642/18789) not listening after VM restart — Plan 4 must bring the sandbox back up.
- Task 3: review Needs fixes: Important — unguarded `${VAR}` build args build silently blank. ⚠️ resolved: VM validation (image builds, config OK, ${HOME} interpolates, uid 1000 node, read-only boot); DNS is a direct A record at GoDaddy (no CDN) so {remote_host} is the real peer.
- Ruling: promote minors into fix round 1 — secret-in-image tests, healthcheck 127.0.0.1, init: true, single appOrigin() const, HSTS (max-age 1y, no includeSubDomains/preload) — public surface, all one-liners — cost: slightly larger fix diff.
- Task 3: minor (deferred): .dockerignore doesn't exclude docs/, deploy/, PRIVATE_NOTES.md (build stage only, never runtime image; VM clone has no PRIVATE_NOTES); string-match style deploy tests; after reboot Caddy may 502 briefly before console is healthy (restart policy ignores depends_on)
- Task 3: fix round 1 dispatched (resume implementer; FIX_BASE d46dda0)
- Task 3: fix round 1 implementer DONE 85e9935 (190/190); scoped re-review dispatched (haiku)
- Task 3: fix round 1/5 (6 addressed, 0 open; commits d46dda0..85e9935); controller re-ran pnpm test (below) + typecheck
- Task 3: minor (deferred): compose build.args not checked for non-NEXT_PUBLIC keys (Dockerfile ARG test blocks the leak); Dockerfile COPY . . before install busts dep cache (build time only)
- Task 3: complete (commits 9ccd2b6..85e9935, review clean after 1 fix round). Runtime compose behaviour verified in T4 on the VM.
- Waiting on Tarik: Task 0 (Clerk prod A–C, Convex key D, .env.production.local E) — full beginner walkthrough given 22:09.
- Task 0 verified 22:37: .env.production.local 8/8 prefixes ok; pk_live → clerk.aircheck.rhythmlabradio.com = issuer; sk_live works, prod demo user role=demo @example.com; 5 Clerk CNAMEs resolve, FAPI 200; Convex prod key opens clever-deer-759 (env empty). Proceeding to Task 4.
- Task 4 done 22:40: prod Convex clever-deer-759 env set, deployed (incl cron), seeded (2 awaiting/2 blocked/2 claims/2 releases); VM ~/.aircheck/console.env 600 (7 keys, no deploy key); compose up: console healthy, caddy got Let's Encrypt cert (until 2027-01-25).
- Task 5 done: http→https 308; https /sign-in 200 + HSTS; /demo 302 relative; external ports open only 22/80/443 (3000/8080/8642/18789/111 closed); limiter 429 after 10 incl forged XFF; live browser: /demo→/today role demo, no dev badge, approve → "Approved · sample, not published" + notice, Trust row; iPhone 13 WebKit @375: scrollWidth 375, Approve/Edit/Skip 48px. Prod demo reseeded after.
- Task 6: dispatched (base 85e9935, sonnet)
- Hermes restart attempt (Tarik-approved) 22:45–22:50: sandbox container exited 143 at VM stop. `nemohermes airc start` refused: ~/.local was 775 (group-writable) → chmod g-w ~/.local ~/.local/bin (now 755). Second start refused: sandbox phase Error. `recover` needs a running container; `docker start` + `recover` → still Error (failedStage=gateway, inference unreachable). Reverted: container stopped again. Next: `nemohermes airc rebuild` (Tarik to approve) at start of Plan 4. Live console unaffected (200 throughout); 8642/18789 closed externally.
- Task 6: implementer DONE f131751 (docs; 190 tests). Review pending.
- Task 6: review Needs fixes: Important — runbook ps/logs lack --env-file (CONFIRMED by controller on VM: interpolation error without it). Minors folded into fix round 1 (docs, cheap): rollback needs clone; billing statements unverified; explicit claims list; CONVEX_DEPLOY_KEY export; define cron/OAuth/308/302/Next.js.
- Task 6: fix round 1 dispatched (resume implementer; FIX_BASE 4e5eb8d)
- Task 6: fix round 1/5 (6 addressed, 0 open; commits 4e5eb8d..0d3e9f9); controller ran runbook dc alias on VM (works in alias-enabled shell)
- Task 6: minor (deferred): rollback vs clone-after-merge wording; "Run from apps/console" prose vs `cd apps/console` in block; alias lasts one SSH session (not stated); Known gaps terms undefined (Hermes/NemoClaw/Telegram/Tavily); duplicated paragraph in report file (scratch)
- Task 6: complete (commits 85e9935..0d3e9f9, review clean after 1 fix round)
- VM is on-demand (no preemptible/spot) — verified. Hermes prevention plan: Plan 4 task 1 = rebuild sandbox (Tarik OK) + systemd boot unit running `nemohermes airc start` + deliberate reboot test + Telegram watchdog.
- Final whole-branch review dispatched (opus)
- Tarik: permanent Hermes fix = FIRST task of Plan 4 (rebuild + systemd boot start + reboot test + Telegram watchdog).
- Final review (opus): no Critical. Important: (1) runbook git clone fails on existing ~/air-check — MUST FIX; (2) reboot recovery unverified. Controller checked: docker+containerd enabled at boot, both containers restart=unless-stopped; full reboot test → Plan 4 task 1.
- Ruling: final fix wave includes I1, I2 (doc), M1 (exclude http.log.error), M4 (caddy mem/pids), M5 (h1/h2 only), M6 (log rotation + prune), M7 (dc down warning, redo gaps), M8 (wording/definitions) — cheap, all on the public surface or runbook — cost: one caddy recreate on the VM.
- Ruling: M3 (origin pin fails open on scheme-less value) resolved by evidence — controller's prefix check of .env.production.local confirmed NEXT_PUBLIC_APP_URL starts with https://aircheck.rhythmlabradio.com; M2 (limiter per-client) left to a cellular-phone check by Tarik (Docker iptables DNAT keeps the IPv4 source) — cost: unproven per-client keying until checked.
- Final fix wave dispatched (FIX_BASE 0d3e9f9, sonnet)
- Final fix wave: implementer DONE ee51470 (193/193). Controller: caddy validate → Valid configuration; deployed to VM (both recreated, console healthy, caddy 256MiB/128 pids, logs 10m×3); live /sign-in 200, HSTS, no Alt-Svc. Scoped re-review dispatched (sonnet).
- Final fix wave: re-review — all 8 ADDRESSED, no new breakage. PLAN 3b COMPLETE (c2ae953..ee51470 + notes).
