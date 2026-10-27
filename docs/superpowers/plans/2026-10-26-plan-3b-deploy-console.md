# Plan 3b: Deploy the console to aircheck.rhythmlabradio.com — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Judges open https://aircheck.rhythmlabradio.com, sign in through the demo door or with a Radio Milwaukee account, and use the Plan 3 console against a production Convex deployment and a production Clerk instance, with only ports 80 and 443 public on the Nebius VM.

**Architecture:** Docker Compose on the existing Nebius VM `airc-vm` runs two hardened containers: `console` (the Next.js standalone build, reachable only on the Compose network) and `caddy` (the only published ports, 80 and 443, with automatic Let's Encrypt HTTPS for `aircheck.rhythmlabradio.com`). Caddy sets the client IP header the `/demo` limiter trusts. Convex runs a new production deployment of the `air-check` project (same code, hourly demo reseed cron). Clerk runs a new production instance on the `aircheck.rhythmlabradio.com` domain. NemoClaw and Hermes stay untouched on loopback.

**Tech Stack:** Next.js 16.4 `output: "standalone"`, Node 24 (`node:24-slim`), Caddy 2 (`caddy:2` image), Docker Compose (already on the VM: Docker 29.9.2, Compose 5.6.1), Convex production deployment, Clerk production instance, GoDaddy DNS for rhythmlabradio.com.

**Spec:** `docs/superpowers/specs/2026-10-26-air-check-design.md` (hosting row in section 4; 5.x "One public host, two doors"), `docs/ARCHITECTURE.md` 3.0, `docs/NEBIUS_SETUP.md` (firewall and the Docker-bypasses-ufw gotcha), and the deploy items carried in `docs/superpowers/plans/2026-10-26-plan-3-execution-notes.md` (Task 6 minors, final-review I2).

## Global Constraints

- Only 80 and 443 are public. NemoClaw dashboard (18789) and API (8642) stay on loopback. Docker publishes bypass ufw, so the `console` service publishes **no** ports; only `caddy` publishes 80/443.
- Hard Rule 8: `NEXT_TELEMETRY_DISABLED=1` and `CLERK_TELEMETRY_DISABLED=1` in the Docker env (build stage and runtime). No analytics.
- Secrets never enter git: on the VM they live in `~/.aircheck/console.env` (mode 600); on Tarik's Mac in `apps/console/.env.local` / `.env.production.local` (git-ignored). Never print a key; check by name or length only.
- Hard Rule 9: the production demo workspace is sample data only and cannot publish. The production deployment never uses Tarik's Bandcamp collection.
- Hardened containers (spec "Hardened containers", openmuse `infra/compose.yaml` pattern): `read_only: true` root filesystem (with a `tmpfs` where Next needs to write), `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, a memory limit and a pids limit, non-root user.
- Never touch the Convex deployment `precise-fish-444`. Production Convex is the `air-check` project's own prod deployment.
- Clerk application domain is **`aircheck.rhythmlabradio.com`**, not the root `rhythmlabradio.com`, so the root domain stays free for other station apps **(Claude's call; see decision 010)**.
- Public canonical origin: `https://aircheck.rhythmlabradio.com` (env `NEXT_PUBLIC_APP_URL`).
- The VM must stay running until Dec 15 for judging (about $0.13/hour, about $96/month, already approved by Tarik on Oct 26).

## Review Focus

1. **A visitor spoofs `X-Forwarded-For` to dodge the `/demo` limit.** Behind Caddy the limiter keys on the address Caddy saw, not on anything the client sent. → Task 1 test `limiter ignores client-sent forwarded-for`.
2. **Next behind a proxy builds redirects from its internal host.** `/demo` must send a relative `Location`, never `http://0.0.0.0:3000/...`. → Task 1 test `demo redirect is relative`.
3. **Clerk is down or the demo user id is wrong.** `/demo` answers a plain 503, never a raw 500 page. → Task 1 test `demo returns 503 when Clerk fails`.
4. **`redirect_url` pointing at another site after sign-in.** Only the console's own origin is allowed. → Task 2 test `allowedRedirectOrigins is the app origin only`.
5. **An internal port leaks to the internet.** From outside the VM only 22, 80 and 443 answer. → Task 5 step `external port check`.

---

## File structure

```
apps/console/
  next.config.ts            output: "standalone" (keeps the NEXT_DIST_DIR override)
  src/app/demo/route.ts     limiter key, relative Location, try/catch
  src/lib/rate-limit.ts     evicts empty keys; size cap
  src/lib/client-ip.ts      clientIp(headers): trusted header only
  src/app/providers.tsx     allowedRedirectOrigins from NEXT_PUBLIC_APP_URL
  src/proxy.ts              authorizedParties from NEXT_PUBLIC_APP_URL
  src/app/demo/route.test.ts, src/lib/client-ip.test.ts
  src/telemetry.test.ts     + Docker files checked
deploy/
  Dockerfile                multi-stage pnpm workspace build -> standalone runtime
  compose.yaml              console + caddy, hardened
  Caddyfile                 aircheck.rhythmlabradio.com -> console:3000, header_up X-Real-IP
  console.env.example       names only
  deploy.test.ts            compose/Caddyfile invariants (vitest, reads YAML as text or via `yaml`)
docs/DEPLOY.md              runbook: DNS records, Clerk prod, Convex prod, VM commands, rollback
docs/decisions/010-clerk-on-the-aircheck-subdomain.md
```

---

### Task 0 (Tarik, manual, about 25 min, done alongside Tasks 1–3)

Claude walks Tarik through each screen. Keys are never pasted into chat.

1. **Clerk production instance.** In the Air Check Clerk app: create the production instance (copy settings from development), domain `aircheck.rhythmlabradio.com`. Sign-in method: **email code** to start (Google sign-in in production needs Tarik's own Google OAuth client, which can be added later). Re-do in production: Convex integration activation, the session-token claims `{"aud":"convex","email":"{{user.primary_email_address}}","email_verified":"{{user.email_verified}}","role":"{{user.public_metadata.role}}"}`, and a demo user with public metadata `{"role":"demo"}` and a non-radiomilwaukee email. Note the production Frontend API URL and the demo user id.
2. **GoDaddy DNS for rhythmlabradio.com.** Add the records the Clerk Domains page lists (CNAMEs for `clerk.aircheck`, `accounts.aircheck`, `clkmail.aircheck` and the two DKIM `clk._domainkey.aircheck` / `clk2._domainkey.aircheck`, or whatever exact names Clerk shows), plus an **A record `aircheck` → the VM's public IP** (Claude reads the IP from `nebius compute instance get` and tells Tarik; it stays out of the repo). Checked 2026-10-26: none of these names exist yet and the domain has no CAA records.
3. **Convex production deploy key.** Convex dashboard → `air-check` project → Production → Settings → generate a deploy key. Paste it into `apps/console/.env.production.local` as `CONVEX_DEPLOY_KEY=` (git-ignored).
4. **Start the VM** (billing resumes): `! nebius --profile airc compute instance start --id <id>` (Claude supplies the id).

Claude verifies by name and length only, and with `dig` for the DNS records.

### Task 1: Harden the `/demo` door for life behind a proxy

**Files:** Create `apps/console/src/lib/client-ip.ts`, `client-ip.test.ts`, `src/app/demo/route.test.ts`. Modify `src/app/demo/route.ts`, `src/lib/rate-limit.ts`, `src/lib/rate-limit.test.ts`.

**Interfaces:**
- Produces: `clientIp(headers: Headers): string` — returns the value of `x-real-ip` (set by Caddy from the TCP peer, overwriting anything the client sent) trimmed, else `"unknown"`. It never reads `x-forwarded-for`.
- `rateLimit` gains eviction: a key whose window is empty is deleted, and the map never holds more than 10,000 keys (oldest evicted first). Existing signature unchanged.
- `/demo` GET: 503 `"The demo is unavailable right now."` (plain text) when `AIRCHECK_DEMO_USER_ID` is missing **or** `createSignInToken` throws (log the error server-side, without the token); otherwise `302` with a **relative** `Location: /sign-in?__clerk_ticket=<token>&redirect_url=/today`.

- [ ] **Step 1: Write the failing tests.** `limiter ignores client-sent forwarded-for` (two requests with different `x-forwarded-for` and the same `x-real-ip` share one bucket). `demo redirect is relative` (Location starts with `/sign-in?`). `demo returns 503 when Clerk fails` (mock `clerkClient().signInTokens.createSignInToken` to reject). `demo mints a 60 s token for the demo user only` (mock asserts `{ userId: AIRCHECK_DEMO_USER_ID, expiresInSeconds: 60 }`). `demo returns 429 after 10 in a minute`. `limiter evicts empty keys`.
- [ ] **Step 2:** Run `pnpm --filter console test demo client-ip rate-limit`. Expected: FAIL.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: all pass.
- [ ] **Step 5:** Commit with `fix(console): demo door safe behind a reverse proxy`.

### Task 2: Pin Clerk to the console's own origin

**Files:** Modify `src/app/providers.tsx`, `src/proxy.ts`, `src/proxy.test.ts`, `apps/console/.env.example` (adds `NEXT_PUBLIC_APP_URL=`).

**Interfaces:**
- `ClerkProvider` gets `allowedRedirectOrigins={[process.env.NEXT_PUBLIC_APP_URL]}` when set (dev without it keeps Clerk's default).
- `clerkMiddleware` gets `authorizedParties: [NEXT_PUBLIC_APP_URL]` when set (Clerk production docs recommend it against subdomain cookie leaks). Confirm both option names with `ctx7` for `@clerk/nextjs` 7.9 before writing.

- [ ] **Step 1: Write the failing tests.** `allowedRedirectOrigins is the app origin only` (render providers with `NEXT_PUBLIC_APP_URL=https://aircheck.rhythmlabradio.com` stubbed; assert the prop). `authorizedParties set from NEXT_PUBLIC_APP_URL` (proxy options).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && NEXT_TELEMETRY_DISABLED=1 pnpm build`. Expected: pass (build still needs no secrets).
- [ ] **Step 5:** Commit with `feat(console): pin Clerk redirects and parties to the app origin`.

### Task 3: Container image, Compose and Caddy

**Files:** Create `deploy/Dockerfile`, `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/console.env.example`, `deploy/deploy.test.ts`. Modify `apps/console/next.config.ts` (`output: "standalone"`), `apps/console/src/telemetry.test.ts`, root `vitest.config.ts` if needed so `deploy/*.test.ts` runs, root `.dockerignore`.

**Interfaces:**
- Dockerfile: build stage on `node:24-slim` with corepack pnpm 10.19, `pnpm install --frozen-lockfile`, `pnpm --filter console build` with build args `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` and env `NEXT_TELEMETRY_DISABLED=1`, `CLERK_TELEMETRY_DISABLED=1`. Runtime stage copies `.next/standalone`, `.next/static`, `public`; runs `node apps/console/server.js` as user `node` on port 3000. Build context = repo root.
- compose.yaml: service `console` (build from the Dockerfile, `env_file: ~/.aircheck/console.env`, **no `ports`**, hardened per Global Constraints, `tmpfs` for `/app/apps/console/.next/cache`, healthcheck on `/sign-in`). Service `caddy` (`caddy:2`, ports `80:80` and `443:443`, volumes for the Caddyfile and `caddy_data`/`caddy_config`, `cap_drop: [ALL]` plus `cap_add: [NET_BIND_SERVICE]`). One internal network.
- Caddyfile: `aircheck.rhythmlabradio.com { reverse_proxy console:3000 { header_up X-Real-IP {remote_host} } }`. Caddy's automatic HTTPS handles the certificate and the 80→443 redirect.
- `console.env.example` lists names only: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CLERK_SECRET_KEY`, `AIRCHECK_DEMO_USER_ID`, `NEXT_TELEMETRY_DISABLED=1`, `CLERK_TELEMETRY_DISABLED=1`.

- [ ] **Step 1: Write the failing tests** in `deploy/deploy.test.ts`: `only caddy publishes ports, and only 80 and 443`. `console is hardened` (read_only, cap_drop ALL, no-new-privileges, mem and pids limits). `caddy sets X-Real-IP from the peer`. Extend `telemetry.test.ts`: the Dockerfile and `console.env.example` contain both telemetry flags.
- [ ] **Step 2:** Run `pnpm test deploy telemetry`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test`, then `docker build -f deploy/Dockerfile -t aircheck-console:local .` on the Mac with throwaway non-secret build args, then `docker compose -f deploy/compose.yaml config -q`. Expected: tests pass, the image builds, the Compose file validates. Run the image locally once with `.env.local` values injected (never printed) and confirm `/sign-in` answers 200 on `http://localhost:3000` through a temporary port mapping that is **not** committed.
- [ ] **Step 5:** Commit with `feat(deploy): console image, hardened compose and Caddy`.

### Task 4: Production Convex, then the VM (controller, after Task 0)

No new code. Every command here touches production; each is announced to Tarik before it runs.

- [ ] **Step 1: Convex prod.** From `apps/console` with `CONVEX_DEPLOY_KEY` loaded from `.env.production.local`: `npx convex env set CLERK_JWT_ISSUER_DOMAIN <prod Frontend API URL>` (value read from the file, never printed), `npx convex deploy`, then `npx convex run seed:seedDemo` against prod. Expected: functions deployed, the cron listed in the prod dashboard, `today:summary` as a demo identity returns 2 awaiting packages.
- [ ] **Step 2: DNS check.** `dig +short aircheck.rhythmlabradio.com` returns the VM IP; each Clerk CNAME resolves; Clerk's Domains page shows all records verified.
- [ ] **Step 3: VM.** Over `ssh user@<ip>`: clone the repo to `~/air-check` (read-only, public repo), write `~/.aircheck/console.env` (mode 600) by `scp` from a local temp file that is deleted afterwards, then `docker compose -f deploy/compose.yaml up -d --build`. Expected: both containers healthy; Caddy log shows a certificate obtained for `aircheck.rhythmlabradio.com`.
- [ ] **Step 4: Loopback check.** On the VM, `ss -tlnp` shows 18789 and 8642 bound to 127.0.0.1 only, and nothing new on 0.0.0.0 except 80/443 (Docker) and 22.
- [ ] **Step 5:** Record the run in `docs/DEPLOY.md` (Task 6) and commit nothing secret.

### Task 5: Prove it live

- [ ] **Step 1: External port check.** From the Mac: `nc -zv -w3 <host> 22 80 443 3000 8642 18789`. Expected: 22, 80, 443 open; 3000, 8642, 18789 refused or filtered.
- [ ] **Step 2: HTTPS.** `curl -sI http://aircheck.rhythmlabradio.com` → 308 to https; `curl -sI https://aircheck.rhythmlabradio.com/sign-in` → 200 with a valid certificate.
- [ ] **Step 3: Demo door.** `curl -sI https://aircheck.rhythmlabradio.com/demo` → 302 with a relative `Location: /sign-in?...` (ticket redacted when printed). Eleven quick requests from one machine → the eleventh is 429; the same with a forged `X-Forwarded-For` → still 429.
- [ ] **Step 4: Browser pass** (ego-browser): `/demo` → `/today` signed in as demo; open the golden package; Approve → "Approved · sample, not published"; Trust shows the row; no "Development" Clerk badge. Then reseed prod demo.
- [ ] **Step 5: Phone pass.** Run the Task 14 phone test against prod with `E2E_BASE_URL=https://aircheck.rhythmlabradio.com` if `@clerk/testing` supports production instances (check with ctx7); otherwise a Playwright iPhone 13 screenshot of the package page, checked by eye and by `scrollWidth <= 390`.
- [ ] **Step 6:** Record results in `docs/SPIKES.md`-style table in `docs/DEPLOY.md`.

### Task 6: Runbook and decision

**Files:** Create `docs/DEPLOY.md` and `docs/decisions/010-clerk-on-the-aircheck-subdomain.md`. Modify `README.md` (hosted demo URL), `docs/FRICTION_LOG.md` (Nebius-side friction found during deploy, if any).

- [ ] `docs/DEPLOY.md`: the DNS records (names only, no IP), the Clerk production checklist, the Convex prod commands, the VM commands (`up -d --build`, logs, restart), how to roll back (`git checkout <previous>` then rebuild), how to stop the VM after Dec 15, and the evidence from Task 5.
- [ ] Decision 010 in the house format with "What actually happened" left blank: Clerk on `aircheck.rhythmlabradio.com` vs the root domain; email-code sign-in first, Google later.
- [ ] Commit with `docs: deploy runbook and decision 010`.

---

**Out of scope here:** Google sign-in in production (needs a Google OAuth client), Crate bridge and agent wiring (Plan 4), ingest/media/publisher (Plan 5), the impeccable type-ramp cleanup.
