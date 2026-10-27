# Plan 4a: Hermes back for good, the Crate bridge, and the agent's submit tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hermes survives a reboot, can research through Crate's keyless tools over a private bridge, and can submit a package draft that lands in Convex as `preparing_audio`, proven by one real Hermes run.

**Architecture:** One sandbox rebuild bakes in our own certificate authority (a small certificate issuer we run), which fixes the stuck sandbox and lets NemoClaw trust the bridge. A new host program, `apps/bridge`, listens on the VM's private address with HTTPS and serves two MCP endpoints: `/crate/mcp` proxies an allowlist of crate-cli tools, and `/aircheck/mcp` offers `package_submit`. `package_submit` forwards plain fields to one Convex HTTP route, which rebuilds and validates the draft with core code before calling the existing internal `packages.submit`. Nothing the agent sends can reach approval or publishing.

**Tech Stack:** TypeScript, Node 22 (VM via nvm), `@modelcontextprotocol/sdk` 1.32.2 (v1 import paths: `@modelcontextprotocol/sdk/server/index.js`, `.../server/streamableHttp.js`, `.../client/index.js`, `.../client/stdio.js`), Node stdlib `https`, Convex HTTP actions, Vitest, `convex-test`, systemd, openssl, NemoClaw `nemohermes` CLI.

**Spec:** `docs/superpowers/specs/2026-10-26-air-check-design.md` (5.3, 10, 11 V4/V12), `docs/decisions/006-crate-bridge-private-only.md`, `docs/ARCHITECTURE.md` 3.0, 3.1, 3.9, ledger `docs/superpowers/plans/2026-10-26-plan-3b-execution-notes.md` (Hermes items at the end). Plan 4b (console: live runs, Take over, chat, live Trust) is written after this plan's Task 7 captures a real Hermes event stream.

**Branch:** `plan-4a/agent-side` from main `468c0d8`, in `~/Projects/air-check`.

## Global Constraints

- Hard Rule 1: the agent can draft; only a signed-in human approves. No code path from model output to approval or Mixcloud. `apps/console/convex/hardRule1.test.ts` must keep passing, updated only as Task 4 says.
- Hard Rule 2: the agent process holds no Box, Drive, Dropbox or Mixcloud credentials. Bridge tokens reach the sandbox only as `openshell:resolve:env:KEY` placeholders.
- Hard Rule 7: no on-air talk, scripts or social copy. Crate's `telegraph_*` and `tumblr_*` publishing tools are never reachable.
- Hard Rule 8: no analytics or telemetry. Bridge logs go to journald on the VM only, tool name and outcome, never arguments.
- Hard Rule 11: no track start times stored or sent.
- crate-cli has no LICENSE: call it, never copy it. Clone `github.com/tmoody1973/crate-cli` at commit `37f4ec2` onto the VM only, never into this repo.
- Crate tools exposed: names starting `musicbrainz_`, `wikipedia_`, `bandcamp_`, `itunes_` only (Tarik, Oct 26: keyless only). Everything else is hidden from `tools/list` and refused on `tools/call`.
- NemoClaw blocks `telegraph_*`, `tumblr_*`, `browser_*`, `whosampled_*` a second time with `--deny-tool` (decision 006).
- Bridge listens on `10.104.0.41:8443` (the VM's private address, Oct 26) and nowhere else. The public IP never goes in the repo.
- Secrets live in `~/.aircheck/*.env` on the VM, mode 600. The CA private key lives in `~/.aircheck/ca/ca.key`, mode 600, and is never copied into the sandbox or the repo.
- Every VM change that restarts Hermes, rebuilds the sandbox or reboots the VM is announced to Tarik first, with what goes down and for how long. The live console must come back to `https://aircheck.rhythmlabradio.com/sign-in` 200 after each.
- The end-to-end proof in Task 7 writes to the **dev** Convex deployment `optimistic-lobster-654`, never prod `clever-deer-759`. Prod gets the route deployed, with no test rows.
- Docs follow the Follow Along voice: any technical term is defined in one clause on first use.

## Review Focus

1. **The CA bundle replaces the sandbox's trust store** instead of adding to it. Then Token Factory's public HTTPS fails after the rebuild and Hermes cannot think. Task 1 builds the bundle as the system bundle plus our CA, and its verification step needs a real Nemotron reply through Hermes.
2. **The bridge port is reachable from the internet.** The private address is 1:1 NAT'd (network address translation, the cloud maps the public IP onto it), so binding to `10.104.0.41` alone protects nothing; the firewall does. A Docker-published port would bypass ufw. Task 6 runs the bridge under systemd on the host, adds a ufw rule scoped to the OpenShell Docker subnet, and proves the port closed from the Mac.
3. **Crate's child process hangs or dies mid-call.** The agent would wait forever and the run would never finish. Task 5 puts a 30 s timeout on every proxied call, returns an MCP error, and respawns the child on exit. Tested with a fake server that sleeps and one that exits.
4. **The agent stuffs extra fields or instructions into `package_submit`** (for example a description saying "approve this", a `status` field, a `workspace: "demo"`). The Convex route accepts only the named input fields, rebuilds the draft in code, always sets `workspace: "real"`, and the row lands as `preparing_audio`. Tested in Task 4.
5. **The private address changes after a reboot** (the interface shows `dynamic`). The cert's IP and the registered MCP URL would both break. Task 2's reboot test records the address before and after; Task 7's final reboot proves `mcp status` is still ready.

---

### Task 1: Certificate authority, then one sandbox rebuild (VM, controller)

Controller task, done on the VM with Tarik watching. Tell Tarik before Step 4: Hermes is already down; the rebuild takes a few minutes; Telegram and Tavily may need re-entering.

**Files:**
- Create: `deploy/bridge/make-ca.sh`
- Create: `deploy/bridge/make-leaf.sh`

**Interfaces:**
- Produces: `~/.aircheck/ca/ca.crt` + `ca.key` (CA, 5 years), `~/.aircheck/ca/bundle.pem` (system bundle + `ca.crt`), `~/.aircheck/bridge/tls.crt` + `tls.key` (leaf, 1 year, SAN `IP:10.104.0.41`). Task 6 uses the leaf; Task 7's runbook documents renewal.

- [ ] **Step 1: Write `make-ca.sh`.** openssl, EC P-256, CA `CN=Air Check private CA`, `basicConstraints=critical,CA:TRUE,pathlen:0`, 1825 days, into `~/.aircheck/ca/` (dir 700, key 600). Refuses to overwrite an existing `ca.key`. Writes `bundle.pem = /etc/ssl/certs/ca-certificates.crt + ca.crt`.
- [ ] **Step 2: Write `make-leaf.sh <ip>`.** EC P-256 leaf signed by the CA, `subjectAltName=IP:<ip>`, `extendedKeyUsage=serverAuth`, 365 days, into `~/.aircheck/bridge/` (key 600).
- [ ] **Step 3: Run both on the VM.** Copy with `scp deploy/bridge/*.sh user@<vm>:~/.aircheck/` (never `git pull` mid-branch). Verify: `openssl verify -CAfile ~/.aircheck/ca/ca.crt ~/.aircheck/bridge/tls.crt` prints `OK`, and `grep -c "BEGIN CERTIFICATE" bundle.pem` is the system count + 1.
- [ ] **Step 4: Rebuild.** `NEMOCLAW_CORPORATE_CA_BUNDLE=$HOME/.aircheck/ca/bundle.pem nemohermes airc rebuild --yes --verbose 2>&1 | tee ~/.aircheck/rebuild-$(date +%F).log`. If the CLI rejects the variable, stop and report; do not retry with other flags.
- [ ] **Step 5: Verify Hermes is back.** `nemohermes airc status` shows the gateway running; `curl -s 127.0.0.1:8642/health` returns 200; one `POST :8642/v1/chat/completions` (gateway token from `nemohermes airc gateway-token --quiet`) returns a Nemotron reply (Review Focus 1). `nemohermes airc status` still lists policies `pypi, tavily, telegram`. Send one Telegram message to the bot and get a reply; if not, `nemohermes airc channels add telegram` with Tarik.
- [ ] **Step 6: Record and commit.** Ledger line with the rebuild log's last 20 lines. `docs/FRICTION_LOG.md`: whether `rebuild` cleared the Error phase, and whether Telegram/Tavily survived it.

```bash
git add deploy/bridge/make-ca.sh deploy/bridge/make-leaf.sh docs/FRICTION_LOG.md
git commit -m "ops: private CA and sandbox rebuild that trusts it"
```

### Task 2: Hermes starts at boot, a watchdog, and a reboot test (VM, controller)

Tell Tarik before Step 4: the reboot takes the public site down for about 2–3 minutes.

**Files:**
- Create: `deploy/hermes/aircheck-hermes.service`
- Create: `deploy/hermes/watchdog.sh`
- Create: `deploy/hermes/aircheck-watchdog.service`, `deploy/hermes/aircheck-watchdog.timer`

**Interfaces:**
- Consumes: Task 1's working sandbox. `TELEGRAM_BOT_TOKEN` and Tarik's chat id from `~/.airc/secrets.env` (host side, outside the sandbox).
- Produces: `watchdog.sh` checks a list of probes; Task 6 adds the bridge probe to it.

- [ ] **Step 1: Boot unit.** `aircheck-hermes.service`: `Type=oneshot`, `RemainAfterExit=yes`, `User=user`, `After=docker.service network-online.target`, `Wants=network-online.target`, `ExecStart=/home/user/.local/bin/nemohermes airc start`, `Environment=PATH=/home/user/.local/bin:/home/user/.nvm/versions/node/<installed>/bin:/usr/bin:/bin`, `TimeoutStartSec=300`, `WantedBy=multi-user.target`.
- [ ] **Step 2: Watchdog.** `watchdog.sh` runs probes (for now one: `curl -sf -m 5 http://127.0.0.1:8642/health`; Task 6 adds the bridge). State file `~/.aircheck/watchdog.state` holds `ok` or `down`. It sends one Telegram message on `ok → down` ("Air Check: Hermes is down since HH:MM. Console unaffected.") and one on `down → ok`, nothing while unchanged. Telegram text carries no links, no secrets. `bash -n` clean; `--dry-run` prints the message instead of sending.
- [ ] **Step 3: Timer.** Every 5 minutes, `OnBootSec=3min`, `Persistent=true`. Install both units under `/etc/systemd/system/`, `systemctl enable --now aircheck-hermes.service aircheck-watchdog.timer`.
- [ ] **Step 4: Prove the watchdog.** `docker stop` the sandbox container → within one timer tick Tarik gets the "down" message; `nemohermes airc start` → the "back" message. Evidence: both message times in the ledger.
- [ ] **Step 5: Reboot test.** Record `ip -4 addr show eth0`, then `sudo reboot`. After: `systemctl status aircheck-hermes` succeeded, `curl 127.0.0.1:8642/health` 200, console `/sign-in` 200 from the Mac, same private address (Review Focus 5), no watchdog "down" message.
- [ ] **Step 6: Commit.** Update `docs/DEPLOY.md` "after a reboot" section: boot start is now automatic, how to read `journalctl -u aircheck-hermes`, what the watchdog messages mean.

```bash
git add deploy/hermes docs/DEPLOY.md
git commit -m "ops: start Hermes at boot and alert Telegram when it goes down"
```

### Task 3: Build a package draft from plain fields (core, TDD)

**Files:**
- Create: `packages/core/src/package/build.ts`
- Modify: `packages/core/src/index.ts` (export it)
- Test: `packages/core/test/build.test.ts`

**Interfaces:**
- Consumes: `parseTracklist`, `buildTitle`, `checkTitleArtists`, `checkTags`, `checkDescription` (core).
- Produces:

```ts
export interface AgentPackageInput {
  showDate: string;        // ISO yyyy-mm-dd
  tracklistText: string;   // the raw tracklist, both hours
  leads: string[];         // title artists, in order
  tags: string[];
  description: string;
  hour1Id: string;
  hour2Id: string;
}
export type BuildResult = { ok: true; draft: PackageDraft } | { ok: false; problems: string[] };
export function buildPackageDraft(input: AgentPackageInput, opts: { privateTerms: string[] }): BuildResult;
```

Draft id is `pkg-<M>-<D>-<YY>` from `showDate` (matches `goldenDraft`: `2026-10-02` → `pkg-10-2-26`), `workspace` is always `"real"`, `audio` is `{ hour1Id, hour2Id }`. Any parser bad line, title-artist problem, tag problem or description issue is a problem (human-readable string); no partial drafts.

- [ ] **Step 1: Write failing tests** in `build.test.ts`, using `readFixture("raw/10-2-26-drive-tracklist.txt")`, `leadsOf(goldenPackageTitles()[0])` and `goldenDescription()` from `test/helpers`:
  - `builds the 10-2-26 golden package`: `ok` true; `draft.tracks.length === 31`; hour 1 has 15, hour 2 has 16; the last track of each hour has `closing: true` and no other track does; titles equal `goldenTitles()`; `draft.id === "pkg-10-2-26"`; `draft.workspace === "real"`.
  - `never emits start times`: `JSON.stringify(draft)` matches no `/start_?time/i`.
  - `rejects a description over 1,000 characters` → `ok` false, a problem mentioning `1,000`.
  - `rejects "out today" in the description` → `ok` false.
  - `rejects a lead artist not in the tracklist` → `ok` false.
  - `rejects a tracklist with a bad line` → `ok` false, the line quoted in the problem.
  - `rejects empty hour ids` → `ok` false.
- [ ] **Step 2: Run** `pnpm --filter @aircheck/core test build` → FAIL, `buildPackageDraft` not exported.
- [ ] **Step 3: Implement** `buildPackageDraft` in `build.ts` by composing the existing checks.
- [ ] **Step 4: Run** `pnpm --filter @aircheck/core test` → all pass (65 + new).
- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/package/build.ts packages/core/src/index.ts packages/core/test/build.test.ts
git commit -m "feat(core): build and validate a package draft from plain fields"
```

### Task 4: One Convex route the bridge can submit through (console/convex, TDD)

Decision 011 (drafted here, Tarik confirms at plan review): the bridge gets a narrow token for one HTTP route, not the Convex deploy key. A deploy key could push new backend code and call `claimForPublish`; this token can only create a `preparing_audio` draft.

**Files:**
- Create: `apps/console/convex/http.ts`
- Create: `apps/console/convex/agentSubmit.ts` (pure helpers: token check, input pick)
- Modify: `apps/console/convex/hardRule1.test.ts`
- Test: `apps/console/convex/agentSubmit.test.ts`
- Create: `docs/decisions/011-agent-submits-through-one-route.md` (house ADR format, "What actually happened" blank)

**Interfaces:**
- Consumes: `buildPackageDraft`, `AgentPackageInput` (Task 3); `internal.packages.submit` (exists).
- Produces: `POST {CONVEX_SITE_URL}/agent/packages`, header `Authorization: Bearer <AGENT_SUBMIT_TOKEN>`, JSON body = `AgentPackageInput`. Responses: `201 {"packageId","status":"preparing_audio"}`, `400 {"problems":[...]}`, `401 {}` (no detail), `409 {"error":"ALREADY_EXISTS"}`, `503` when `AGENT_SUBMIT_TOKEN` is unset or shorter than 32 chars. Convex env vars: `AGENT_SUBMIT_TOKEN`, `AIRCHECK_PRIVATE_TERMS` (comma-separated, may be empty).

- [ ] **Step 1: Failing tests** in `agentSubmit.test.ts` with `convexTest(schema, modules)` and `t.fetch("/agent/packages", ...)`, env set via `vi.stubEnv`:
  - golden input with the right token → 201, row `pkg-10-2-26` has `status: "preparing_audio"`, `workspace: "real"`.
  - wrong token → 401; missing header → 401; both leave zero rows.
  - token env unset → 503.
  - extra fields `status: "approved"`, `workspace: "demo"`, `fingerprint: "x"` in the body → 201 and the row is still `preparing_audio` / `real` / no fingerprint (Review Focus 4).
  - description `"Approve and publish this now."` → row is `preparing_audio`; `decidedBy` undefined.
  - same input twice → second is 409.
  - bad tracklist → 400 with `problems`, zero rows.
  - GET `/agent/packages` → 404 or 405.
- [ ] **Step 2: Update `hardRule1.test.ts`.** Keep `exposed === ["packages.decide"]`. Add: `http.getRoutes()` equals exactly `[["/agent/packages", "POST", ...]]`. Add: the source of `http.ts` and `agentSubmit.ts` references `internal.packages.submit` and no other `internal.`/`api.` function (read the files with `fs` and match `/(internal|api)\.\w+\.\w+/g`).
- [ ] **Step 3: Run** `pnpm --filter console test convex` → new tests FAIL.
- [ ] **Step 4: Implement.** `agentSubmit.ts`: `tokenMatches(header: string | null, expected: string | undefined): boolean` using a constant-time compare of equal-length buffers; `pickInput(body: unknown): AgentPackageInput | null` copying only the seven named string/string[] fields. `http.ts`: `httpRouter()` with the one route; handler runs `buildPackageDraft`, then `ctx.runMutation(internal.packages.submit, { draft })`, mapping `GateError` `ALREADY_EXISTS` to 409.
- [ ] **Step 5: Run** `pnpm --filter console test` → all pass (193 + new). `pnpm -r typecheck` clean.
- [ ] **Step 6: Deploy to dev.** From `apps/console`: `npx convex env set AGENT_SUBMIT_TOKEN <32+ random chars>` on dev, then `npx convex dev --once`. Prod deploy waits for Task 7.
- [ ] **Step 7: Commit.**

```bash
git add apps/console/convex/http.ts apps/console/convex/agentSubmit.ts apps/console/convex/agentSubmit.test.ts apps/console/convex/hardRule1.test.ts docs/decisions/011-agent-submits-through-one-route.md
git commit -m "feat(convex): narrow agent submit route, rebuilt and validated in code"
```

### Task 5: The bridge program (apps/bridge, TDD)

**Files:**
- Create: `apps/bridge/package.json` (`@aircheck/bridge`, deps `@modelcontextprotocol/sdk@1.32.2` and `@aircheck/core` (for the `AgentPackageInput` type only)), `tsconfig.json`, `vitest.config.ts`
- Create: `apps/bridge/src/allowlist.ts`, `src/auth.ts`, `src/crateProxy.ts`, `src/aircheckTools.ts`, `src/server.ts`, `src/config.ts`
- Test: `apps/bridge/test/allowlist.test.ts`, `test/auth.test.ts`, `test/crateProxy.test.ts`, `test/aircheckTools.test.ts`, `test/fixtures/fake-crate.mjs`

**Interfaces:**
- Consumes: `POST /agent/packages` contract (Task 4).
- Produces:
  - `isAllowedCrateTool(name: string): boolean` (prefixes in Global Constraints).
  - `bearerOk(header: string | undefined, expected: string): boolean` (constant time).
  - `createCrateProxy(opts: { command: string; args: string[]; cwd: string; timeoutMs: number }): { listTools(): Promise<Tool[]>; callTool(name: string, args: unknown): Promise<CallToolResult>; close(): Promise<void> }`. Spawns the child with env `{ PATH, HOME, NODE_ENV: "production" }` only, so no key-gated Crate server can switch on. Respawns on child exit.
  - `packageSubmitTool(opts: { siteUrl: string; token: string; fetch?: typeof fetch })`: MCP tool `package_submit`, input schema = `AgentPackageInput` fields, returns text `"Submitted pkg-… (preparing audio). A person reviews it in the console."` or the problems list. It never claims approval.
  - `startServer(config: BridgeConfig)`: Node `https.createServer` with `tls.key/crt`, routes `POST /crate/mcp` (bearer `CRATE_MCP_TOKEN`) and `POST /aircheck/mcp` (bearer `AIRCHECK_MCP_TOKEN`), `GET /healthz` 200 `ok` with no auth and no detail; everything else 404. Each MCP request gets a fresh low-level `Server` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`. Logs one line per tool call: `tool=<name> ok=<bool> ms=<n>`, never arguments.
  - `BridgeConfig` read by `loadConfig(env)`; throws naming the missing variable for `BRIDGE_HOST`, `BRIDGE_PORT`, `TLS_CERT`, `TLS_KEY`, `CRATE_DIR`, `CRATE_MCP_TOKEN`, `AIRCHECK_MCP_TOKEN`, `CONVEX_SITE_URL`, `AGENT_SUBMIT_TOKEN`; rejects tokens under 32 chars.

- [ ] **Step 1: Failing tests.**
  - `allowlist`: `musicbrainz_search_artist` true; `wikipedia_x`, `bandcamp_x`, `itunes_x` true; `telegraph_post`, `tumblr_post`, `browser_open`, `whosampled_x`, `youtube_x`, `news_x`, `collection_x`, `playlist_x`, `radio_x`, `discogs_x`, `musicbrainzx` false.
  - `auth`: right token true; wrong token, missing header, `Basic …`, different length false.
  - `crateProxy` against `fake-crate.mjs` (a stdio MCP server built with the SDK exposing `musicbrainz_echo`, `telegraph_post`, `musicbrainz_sleep`, `musicbrainz_exit`): `listTools()` returns only `musicbrainz_echo`, `musicbrainz_sleep`, `musicbrainz_exit`; `callTool("telegraph_post")` rejects without reaching the child (the fake writes a marker file when called; assert absent); `musicbrainz_sleep` with `timeoutMs: 200` returns an MCP error within 1 s (Review Focus 3); after `musicbrainz_exit`, the next `musicbrainz_echo` succeeds (respawn); the child sees no `DISCOGS_KEY` even when the parent env has one.
  - `aircheckTools` with a stub `fetch`: 201 → success text containing `preparing audio` and not `approved`; 400 → text lists problems; 401/503 → "submit is not configured" without echoing the token; request carries `Authorization: Bearer <token>` and only the seven fields.
  - `server` (in `aircheckTools.test.ts` or its own file, self-signed cert generated in `beforeAll` via `openssl` child process): `/crate/mcp` without bearer → 401; `/healthz` → 200 `ok`; `/other` → 404.
- [ ] **Step 2: Run** `pnpm --filter @aircheck/bridge test` → FAIL.
- [ ] **Step 3: Implement** the modules. Use the low-level `Server` with `ListToolsRequestSchema` / `CallToolRequestSchema` handlers that forward to the proxy, so Crate's schemas pass through untouched. `Promise.race` against a timer for the timeout.
- [ ] **Step 4: Run** `pnpm --filter @aircheck/bridge test` and `pnpm -r typecheck` → pass. Root `pnpm test` still green.
- [ ] **Step 5: Commit.**

```bash
git add apps/bridge pnpm-lock.yaml
git commit -m "feat(bridge): private HTTPS MCP bridge for Crate and package_submit"
```

### Task 6: Run the bridge on the VM and register it with NemoClaw (VM, controller)

**Files:**
- Create: `deploy/bridge/aircheck-bridge.service`
- Create: `deploy/bridge/bridge.env.example` (names only)
- Modify: `deploy/hermes/watchdog.sh` (add the bridge probe)

**Interfaces:**
- Consumes: Task 1 leaf cert, Task 5 build, Task 4 dev route.
- Produces: `https://10.104.0.41:8443/crate/mcp` and `/aircheck/mcp`, registered as NemoClaw MCP servers `crate` and `aircheck`.

- [ ] **Step 1: Crate on the VM.** `git clone https://github.com/tmoody1973/crate-cli ~/crate-cli && cd ~/crate-cli && git checkout 37f4ec2 && npm ci && npm run build`. Check: `ls dist/mcp-server.js`.
- [ ] **Step 2: Bridge on the VM.** Copy the branch's `apps/bridge` build output and its `node_modules` (or `pnpm deploy --filter @aircheck/bridge --prod ~/aircheck-bridge` on the Mac, then `rsync`). Write `~/.aircheck/bridge.env` (600): `BRIDGE_HOST=10.104.0.41`, `BRIDGE_PORT=8443`, the TLS paths, `CRATE_DIR=/home/user/crate-cli`, three fresh 48-char tokens, `CONVEX_SITE_URL` = dev site URL.
- [ ] **Step 3: systemd.** `aircheck-bridge.service`: `User=user`, `EnvironmentFile=/home/user/.aircheck/bridge.env`, `ExecStart=<node> /home/user/aircheck-bridge/dist/server.js`, `Restart=on-failure`, `After=network-online.target`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=` none. Enable and start. Check: `curl -sf --cacert ~/.aircheck/ca/ca.crt https://10.104.0.41:8443/healthz` → `ok`.
- [ ] **Step 4: Firewall.** Find the OpenShell subnet with `docker network inspect openshell-docker -f '{{(index .IPAM.Config 0).Subnet}}'`. `sudo ufw allow from <subnet> to 10.104.0.41 port 8443 proto tcp`. From the Mac: `nc -vz -w 5 <public IP> 8443` fails (Review Focus 2). On the VM: `ss -ltnp | grep 8443` shows only `10.104.0.41:8443`.
- [ ] **Step 5: Register.** With the tokens exported in the shell:

```bash
nemohermes airc mcp add crate --url https://10.104.0.41:8443/crate/mcp --env CRATE_MCP_TOKEN \
  --trusted-private-host 10.104.0.41 \
  --deny-tool 'telegraph_*' --deny-tool 'tumblr_*' --deny-tool 'browser_*' --deny-tool 'whosampled_*'
nemohermes airc mcp add aircheck --url https://10.104.0.41:8443/aircheck/mcp --env AIRCHECK_MCP_TOKEN \
  --trusted-private-host 10.104.0.41
```

Verify: `nemohermes airc mcp status crate --json --tools` shows ready, `trustedPrivateTarget.state: "match"`, tools only from the four allowed prefixes; same for `aircheck` with exactly `package_submit`.
- [ ] **Step 6: Watchdog probe.** Add the `/healthz` probe; `--dry-run` with the bridge stopped prints a "bridge is down" message.
- [ ] **Step 7: Commit.**

```bash
git add deploy/bridge/aircheck-bridge.service deploy/bridge/bridge.env.example deploy/hermes/watchdog.sh
git commit -m "ops: run the bridge on the private address and register it with NemoClaw"
```

### Task 7: One real Hermes run, captured events, final reboot, docs (VM + repo, controller)

**Files:**
- Create: `spikes/v4-bridge/run.py` (adapted from `spikes/v12-runs/v12.py`; writes raw SSE lines)
- Create: `packages/core/test/fixtures/hermes-run-events.ndjson` (from the real run; no secrets, no tokens)
- Modify: `packages/core/src/runs.ts` only if the captured field names differ from the reducer's
- Test: `packages/core/test/runs-live.test.ts`
- Modify: `docs/SPIKES.md` (V4 → Pass), `docs/DEPLOY.md`, `docs/FRICTION_LOG.md`, `docs/ARCHITECTURE.md` 3.0 (bridge row), `docs/LEARNING-LOG.md` (draft entry, Tarik's lines blank), decision 006 (leave "What actually happened" blank for Tarik)

- [ ] **Step 1: The run.** `POST /v1/runs` with a task: "Look up Seun Kuti in MusicBrainz, then submit the 10-2-26 package with these fields: …" (golden input, `hour1Id: "box-h1"`, `hour2Id: "box-h2"`, tags from `goldenDraft`). Stream `/v1/runs/{id}/events` to the ndjson file.
- [ ] **Step 2: Check the proof.** Events include `tool.started` for a `musicbrainz_*` tool and for `package_submit`; run ends `run.completed`. Dev Convex has `pkg-10-2-26` with `status: "preparing_audio"`. `nemohermes airc logs` shows the MCP calls and no new denied host. The bridge journal shows `tool=… ok=true` lines with no arguments.
- [ ] **Step 3: Pin the event shape.** `runs-live.test.ts` replays the ndjson through `applyRunEvent` and asserts: one step per `tool.started`, each completed step `done`, final `status: "completed"`, non-empty `output`. If the Plan 3-parked names (`error`, `duration`, `text`/`message`, `output`) differ, fix the reducer to the real names and say so in the ledger. This file is Plan 4b's input.
- [ ] **Step 4: Clean dev, deploy prod route.** Delete the test row from dev. Set `AGENT_SUBMIT_TOKEN` (new value) on prod, deploy prod (`CONVEX_DEPLOY_KEY` export as in `docs/DEPLOY.md`), point `bridge.env` `CONVEX_SITE_URL` at prod, restart the bridge. No test submit against prod.
- [ ] **Step 5: Final reboot (tell Tarik first, 2–3 minutes down).** After: console 200, Hermes health 200, bridge `/healthz` ok, `mcp status crate` ready with `match`, same private address, no watchdog alert.
- [ ] **Step 6: Docs.** `DEPLOY.md`: bridge service, tokens, firewall rule, CA and leaf renewal dates (leaf expires 365 days from Task 1; set a calendar reminder for Tarik), watchdog. Remove "Hermes is currently down" from Known gaps. `SPIKES.md` V4 Pass with evidence. `ARCHITECTURE.md` 3.0: Crate runs as a host process behind the bridge, not a container.
- [ ] **Step 7: Commit, then the finishing skill.**

```bash
git add spikes/v4-bridge packages/core/test packages/core/src/runs.ts docs
git commit -m "test: pin Hermes run events from a real bridge run; docs for the bridge"
```

Then superpowers:finishing-a-development-branch (PR to main; CI must be green).
