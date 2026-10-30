# Deploying the Air Check console

The console (the website) runs on one Nebius virtual machine (VM) called `airc-vm`, in Docker. The live site is https://aircheck.rhythmlabradio.com. Sign-in is Clerk, the database is Convex. Both are hosted services, so the VM only runs the website and a front door.

This page has no addresses or keys on purpose, because the repo is public. The VM's static IP is in the Nebius console. Secrets live only in `~/.aircheck/console.env` on the VM (mode 600, meaning only its owner can read it) and in `apps/console/.env.production.local` on Tarik's Mac.

## The pieces

- **Docker Compose** (a tool that starts several containers from one file): `deploy/compose.yaml` starts two containers.
- **`console`**: the website, a Next.js app (a React web framework), built by `deploy/Dockerfile`. It has no published port, so nothing outside can reach it directly.
- **`caddy`**: a web server that takes ports 80 and 443, gets a free HTTPS certificate from Let's Encrypt by itself, and passes traffic to `console`. Config is `deploy/Caddyfile`. It writes no access log on purpose, because a sign-in link can carry a one-time token. Caddy still logs its own startup and certificate messages. Failed hand-offs to `console` (called proxy errors) are a separate kind of entry that can include the page address, so `deploy/Caddyfile` switches those off too. It also turns off HTTP/3 (the newest web protocol, which needs a UDP port we do not open).
- **Convex production** (deployment `clever-deer-759`): the database and the hourly scheduled job (a cron) in `apps/console/convex/crons.ts` that re-seeds the demo workspace.

## One-time setup (already done)

### DNS (at GoDaddy, the company that holds `rhythmlabradio.com`)

DNS is the public address book that maps names to servers. Six records, all under `rhythmlabradio.com`:

| Type | Name | Points to |
|---|---|---|
| A | `aircheck` | the VM's static IP (Nebius console) |
| CNAME | `clerk.aircheck` | value shown in the Clerk dashboard |
| CNAME | `accounts.aircheck` | value shown in the Clerk dashboard |
| CNAME | `clkmail.aircheck` | value shown in the Clerk dashboard |
| CNAME | `clk._domainkey.aircheck` | value shown in the Clerk dashboard |
| CNAME | `clk2._domainkey.aircheck` | value shown in the Clerk dashboard |

The VM's public IP must be static. By default Nebius frees it when the VM stops, and the A record would then point nowhere. It is set on the network interface (`public_ip_address: {static: true}`), and `nebius compute instance update` needs `--parent-id <project id>` passed explicitly (see `docs/FRICTION_LOG.md`).

### Clerk production checklist

Clerk production instance on domain `aircheck.rhythmlabradio.com` (see decision 010).

1. Create the production instance and add the domain; add the five CNAMEs above; wait until Clerk shows them verified.
2. Sign-in method: email code only for now. Google needs your own Google OAuth client (the registration that lets Google trust our sign-in page), so it comes later.
3. Turn on the Convex integration (this creates the JWT template, the token Convex uses to know who is signed in). Its issuer domain is `https://clerk.aircheck.rhythmlabradio.com`.
4. Edit the session token (Sessions, then Customize session token) so it carries these claims: `aud` set to `convex`, `email`, `email_verified`, and `role` taken from the user's public metadata.
5. Create the demo user with public metadata `{"role":"demo"}` and an email that is not `@radiomilwaukee.org`.
6. Copy the `pk_live_...` publishable key, the `sk_live_...` secret key and the demo user's id into the env files below.

### Convex production commands

Run from the repo root on the Mac (the first line moves into `apps/console`). The Convex deploy key (a `prod:...` key) comes from `apps/console/.env.production.local`, which is gitignored. It must never be copied to the VM.

```sh
cd apps/console
export CONVEX_DEPLOY_KEY=$(grep '^CONVEX_DEPLOY_KEY=' .env.production.local | cut -d= -f2-)
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.aircheck.rhythmlabradio.com
npx convex deploy -y            # pushes functions, schema and the hourly cron
npx convex run seed:seedDemo    # loads the sample workspace
unset CONVEX_DEPLOY_KEY
```

### The VM's env file

Copy `deploy/console.env.example` to `~/.aircheck/console.env` on the VM, fill in the values, then `chmod 600` it. It holds ten names: the Convex URL, the Clerk publishable and secret keys, the app URL, the demo user id, two telemetry-off switches, and the three Mixcloud settings (`MIXCLOUD_CLIENT_ID`, `MIXCLOUD_CLIENT_SECRET`, and `MIXCLOUD_TOKEN_FILE`, which stays empty to mean `/mixcloud/token.json`). It has no Convex deploy key. In the Mixcloud app settings, the redirect URI must be exactly the app URL followed by `/api/mixcloud/callback`.

The `NEXT_PUBLIC_*` values are baked into the image when it is built, so changing one needs a rebuild, not just a restart.

### The Mixcloud token folder

"Connect Mixcloud" in the console's Settings page writes the Mixcloud access token to `~/.aircheck/mixcloud/token.json`. The publisher (a separate service on the VM) is the only other thing that reads it. The token is never stored in Convex. The console container runs as user id 1000 and the VM's own user is 1001, so the folder is shared through its group. Create it before the first `up`, because Docker would otherwise create it owned by root and the console could not write to it:

```sh
mkdir -p ~/.aircheck/mixcloud ~/aircheck-audio/inbox ~/aircheck-audio/prepared
sudo chown 1000:1001 ~/.aircheck/mixcloud
sudo chmod 2770 ~/.aircheck/mixcloud   # owner 1000, group 1001; the 2 (setgid) makes new files group 1001
```

The console writes `token.json` with mode 640: the console can rewrite it and the publisher (group 1001) can read it, and no one else can. Check after connecting with `ls -ln ~/.aircheck/mixcloud` (expect `-rw-r----- 1000 1001`). "Disconnect" in Settings deletes the file. The container mounts only this folder and the ingest token folder (below) read-write, plus `~/aircheck-audio/prepared` read-only for the player; the rest of the container stays read-only.

### The ingest token folder (Connect Google Drive, Connect Dropbox)

"Connect Google Drive" and "Connect Dropbox" in Settings write a read-only refresh token to `~/.aircheck/ingest-tokens/google.json` and `dropbox.json` (`{refresh_token, account, connectedAt}`; never the access token or the app secret). The ingest service (Plan 6) is the only other thing that reads them; they are never stored in Convex. Same sharing as the Mixcloud folder. Create it before the console rebuild that first mounts it (the Plan 6 deploy; see "Deploy order"), otherwise Docker creates the folder as root and Connect fails:

```sh
mkdir -p ~/.aircheck/ingest-tokens
sudo chown 1000:1001 ~/.aircheck/ingest-tokens
sudo chmod 2770 ~/.aircheck/ingest-tokens   # owner 1000, group 1001; setgid so new files are group 1001
```

Each file is written with mode 640 (check with `ls -ln ~/.aircheck/ingest-tokens`, expect `-rw-r----- 1000 1001`). "Disconnect" deletes that provider's file. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` in `console.env` (setup steps: `docs/superpowers/research/2026-10-28-plan-6-api-research.md`, "Owner setup steps"). Redirect URIs: `<NEXT_PUBLIC_APP_URL>/api/google/callback` and `/api/dropbox/callback`. Box has no button: it is a server app configured in the ingest service's own env file.

## Everyday commands (on the VM)

Connect with `ssh user@<the VM's static IP>`. The code is in `~/air-check`.

Start or update (builds first if the code changed):

```sh
cd ~/air-check
docker compose --env-file ${HOME}/.aircheck/console.env -f deploy/compose.yaml up -d --build
```

Every compose command needs `--env-file`, even `ps` and `logs`, because the compose file requires three values (the Convex URL, the Clerk publishable key and the app URL) and refuses to run without them. A shortcut for the rest of this page:

```sh
cd ~/air-check
alias dc='docker compose --env-file ${HOME}/.aircheck/console.env -f deploy/compose.yaml'
```

The `dc` alias lasts only for the current SSH session, so paste it again after reconnecting.

Look at the state and the logs:

```sh
dc ps                  # console should say "healthy"
dc logs -f console
dc logs -f caddy
```

Restart without rebuilding:

```sh
dc restart
```

### Getting new code onto the VM

The first copy was sent from the Mac with `git archive` (a snapshot of the files with no history), so `~/air-check` already exists and `git clone` into it would fail. Once the `deploy/console` branch is merged, move the copy aside and clone instead:

```sh
mv ~/air-check ~/air-check.archive                              # first time only
git clone https://github.com/tmoody1973/air-check ~/air-check   # first time only
cd ~/air-check && git pull                                      # every update after that
```

The Compose project name stays `deploy` (Compose names it after the folder that holds the compose file, `deploy/`), not after `~/air-check`. So the new clone reuses the `deploy_caddy_data` volume (Docker's saved storage for Caddy) and the HTTPS certificate survives. Then run the start/update command above. If Convex functions changed, also run `npx convex deploy -y` from the Mac.

Clean up old build leftovers after an update, so the disk does not fill before Dec 15:

```sh
docker image prune -f      # removes unused old images
docker builder prune -f    # removes the build cache
```

Both containers also keep at most three 10 MB log files each.

### After a reboot

Both containers have `restart: unless-stopped`, and `docker` and `containerd` (the engine underneath Docker) are enabled at boot, so the site comes back by itself. This was tested with a full VM reboot on 2026-10-27: the console answered 200 again, Hermes was healthy 55 seconds after boot, and the bridge and watchdog came up on their own (details in the Hermes section below). After any reboot, still check:

```sh
dc ps     # console should say "healthy" and caddy should be "Up"
```

If console is not healthy or caddy is not up, run the start command from the top of this section. Then check the site:

```sh
curl -sI https://aircheck.rhythmlabradio.com/sign-in    # expect HTTP/2 200
```

### Stop the site but keep the VM

```sh
dc down
```

**Never add `-v` to this command.** It deletes the `caddy_data` volume, which holds the HTTPS certificate. Asking Let's Encrypt for new certificates over and over can hit its rate limits (it refuses to issue more for a while). `dc up -d` brings the site back.

### Redo from scratch on a new VM

1. Set up Docker and the firewall as in `docs/NEBIUS_SETUP.md`.
2. Make the folder for secrets: `mkdir -p ~/.aircheck && chmod 700 ~/.aircheck`, then create `console.env` as described above, the Mixcloud token folder as in "The Mixcloud token folder", and the ingest token folder as in "The ingest token folder".
3. Point the `aircheck` A record at the new VM's IP, and wait until it resolves. It must resolve before the first `up`, or the certificate request fails.
4. `git clone https://github.com/tmoody1973/air-check ~/air-check`, then run the start command.
5. The agent side (Hermes, bridge, watchdog) has its own steps, each described in the sections below:
   - Linger on: `sudo loginctl enable-linger user`. The VM user must be uid 1001 (the units hard-code `user@1001` and `/run/user/1001`).
   - The bridge bundle, before its unit: `mkdir -p ~/aircheck-bridge`, then steps 1–4 of "Updating the bridge" below.
   - The relay bundle and settings: `mkdir -p ~/aircheck-relay/dist`, then steps 1–3 of "Updating the relay" below, and `~/.aircheck/relay.env` (mode 600) from `deploy/relay/relay.env.example`.
   - The four units: `aircheck-hermes.service`, `aircheck-bridge.service`, `aircheck-relay.service` and `aircheck-watchdog.service` plus its `.timer` (copies in `deploy/`).
   - The two forward units, the watchdog's sudo rule and the agent config: `bash deploy/hermes/install-forward.sh` (see "The supervised forwards").
   - The private CA and leaf certificate: `deploy/bridge/make-ca.sh`, then `make-leaf.sh <private ip>`.
   - `crate-cli` cloned to `~/crate-cli` at commit `37f4ec2`, built with `npm ci && npm run build`.
   - `~/.aircheck/bridge.env` (mode 600) from `deploy/bridge/bridge.env.example`.
   - The ufw rule that lets only the sandbox network reach port 8443.
   - Both `nemohermes airc mcp add` commands (crate and aircheck).
   - The station skills: `deploy/hermes/install-skills.sh` (see "Agent skills").
   - ffmpeg (`sudo apt-get install -y ffmpeg`), then the media service and the publisher, each as in its own section below.

## The Hermes sandbox

Hermes is the AI agent that drafts show material. It runs inside a NemoClaw sandbox (a locked-down container) called `airc`. A program called the OpenShell gateway supervises the sandbox. Everything in this section runs on the VM.

**What keeps it alive across a reboot**

- **Linger is on.** The gateway is a systemd *user* service (systemd is Ubuntu's service manager), `nemoclaw-openshell-gateway.service`. Ubuntu only runs user services while someone is logged in over SSH, unless "linger" is on. It was off, so after a VM stop and start nothing launched the gateway and the sandbox went to phase `Error`. The fix, already applied: `sudo loginctl enable-linger user`. Do not undo it (`disable-linger` would bring the outage back).
- **A boot unit.** `/etc/systemd/system/aircheck-hermes.service` (a copy lives in the repo at `deploy/hermes/aircheck-hermes.service`) runs `nemohermes airc start` at boot. Then it retries `nemohermes airc recover` every 15 seconds for up to 5 minutes. Both are needed: `start` does not bring back the forwarded port 8642 that the console talks to, and `recover` does, but only once the sandbox is up.
- **Re-wiring the agent's tools.** After `recover`, the unit runs `nemohermes airc mcp restart`, wrapped in `timeout 120` so a hung re-wire cannot use up the unit's start time. Why: on Oct 28, after the Oct 27 restarts, `airc`'s two registered tool servers (`aircheck` and `crate`) showed "mismatch" (registered but not wired to the agent), so a live draft failed with "package_submit not available" until `mcp restart` was run by hand. It is harmless when the tools are already wired. `aircheck-hermes-demo.service` does the same for `aircdemo`. The reboot test on Oct 28 (20:58 UTC) showed "Reloaded MCP server" in the boot log and both sandboxes back with all three tools, with no hand repair.
- **A supervised forward.** The console reaches Hermes through a host "forward" on `127.0.0.1:8642` (a small `openshell forward service` process that carries each connection into the sandbox). `recover` starts it detached, so nothing restarts it if it exits, and it did exit during two gateway stalls on Oct 29. `aircheck-hermes-forward.service` now runs that same forward under systemd and restarts it 1 second after any exit. See "The supervised forwards" below.
- **A clean shutdown.** When the VM stops, the unit runs `openshell sandbox stop airc` before Docker and the gateway stop. It is an `ExecStopPost` step, so it also runs when a shutdown interrupts the boot retries or the start times out (systemd skips a plain `ExecStop` in both cases). Without it, Docker kills the container first, the gateway records an unexpected exit, and the sandbox lands in `Error` instead of `Stopped`.

Check it:

```sh
nemohermes airc status                      # Phase should be Ready
curl -s http://127.0.0.1:8642/health        # expect a 200 response
systemctl status aircheck-hermes            # expect active (exited)
```

`active (exited)` does not mean Hermes is healthy: the unit stays active even if `recover` gave up after 5 minutes (that is deliberate, so a failed unit cannot skip the clean shutdown). The real check is `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8642/health`.

**If the sandbox is in `Error` anyway**

`Error` is a dead end. `openshell sandbox stop` needs `Ready`, `start` needs `Stopped`, `recover` only reports, and `rebuild` fails its preflight check ("Sandbox 'airc' is unreachable"). Only destroying the sandbox and onboarding it again clears it. Since Plan 7, rebuild `airc` only with `deploy/hermes/reonboard-without-tavily.sh`, never with `~/.aircheck/reonboard.sh` by itself: `~/.airc/secrets.env` still holds `TAVILY_API_KEY`, and a plain re-onboard would give the sandbox its own Tavily door back (see "Plan 7: sourced research"). The script calls `~/.aircheck/reonboard.sh` with a copy of `secrets.env` that has no Tavily key; `reonboard.sh` uses the same settings as the original install and adds `NEMOCLAW_CORPORATE_CA_BUNDLE=~/.aircheck/ca/ca.crt` (see Certificates below). It takes about a minute. Run it inside `tmux` (or with `nohup`): a dropped SSH session mid-rebuild is the riskiest moment.

1. Destroy needs the old container running, so start it first: `docker ps -a` to find its name, then `docker start <container>`. (If an earlier run already destroyed it and there is no `airc` container, skip this. Unverified: how `reonboard.sh` handles a sandbox that is already gone; if it stops, send the output.)
2. On the VM, as `user`, in `~/air-check` after `git pull`:

   ```sh
   bash ~/air-check/deploy/hermes/reonboard-without-tavily.sh --from-error
   ```

   `--from-error` skips the check that `airc` is Ready and goes on without a backup if the sandbox cannot be read. Everything else is the same as the checklist under "Re-onboard checklist": it pauses the watchdog, the relay and the `airc` forward, re-onboards without Tavily, updates the relay's gateway token, registers both bridge tools again, re-applies the skill-writing lock and the station skills in both sandboxes (`apply-agent-config.sh --with-skills`), starts the forward, relay and watchdog again, and runs the checks.
3. If it stops after the re-onboard step, it says: "Run this script again (add --from-error if the sandbox is not Ready)." Do that. Do not finish the steps by hand with `reonboard.sh`.

After a destroy and `onboard-demo.sh` for `aircdemo`, run `bash ~/air-check/deploy/hermes/apply-agent-config.sh --with-skills` too (see "Agent skills"); `aircdemo` never gets a Tavily key.

**Hermes loses its memory when this runs.** A copy of the Hermes home from before the outage is at `~/.aircheck/hermes-backup-2026-10-27/` on the VM. It holds keys tied to that machine, so never copy it off the VM.

### The supervised forwards

Each Hermes API port has its own unit (repo copies in `deploy/hermes/`):

| Unit | Port | Sandbox |
|---|---|---|
| `aircheck-hermes-forward.service` | `127.0.0.1:8642` | `airc` |
| `aircheck-hermes-demo-forward.service` | `127.0.0.1:8643` | `aircdemo` |

- **What it runs.** Exactly the command NemoClaw's `recover` runs (`openshell --gateway nemoclaw ... forward service airc --target-port 8642 --target-host 127.0.0.1 --local 127.0.0.1:8642`). It has to be exact: `recover` checks the listener's full command line, and a match means it leaves the port alone instead of calling it foreign.
- **Restarts.** `Restart=always`, `RestartSec=1`, and `StartLimitIntervalSec=0` so systemd never gives up.
- **Taking over from a stray forward.** At boot, `aircheck-hermes.service` still runs `recover`, which starts its own unsupervised forward first. The unit's `ExecStartPre` (`~/.aircheck/forward-adopt.sh`) stops a listener on its port only when that listener's full command line equals the unit's `ExecStart` and it is at least 30 seconds old, then the unit binds the port. A younger one may have just been started by NemoClaw (an onboard or a `recover`), so it is left alone and the unit retries every second until it is old enough. Anything else on the port is left alone and the unit keeps retrying. Expect a gap of about a second.
- **The demo command line** is the airc command with `aircdemo` and `8643`. It was checked byte for byte against the live 8643 forward (pid 8937, Oct 29). The installer compares it again before it changes anything, and stops if they differ.

**Install or update** (on the VM, as `user`, after `git pull` in `~/air-check`), when no draft is in progress. Handing a port to its unit drops open connections for about a second. Check first that this prints nothing: `ss -tn state established '( sport = :8642 )'`. The installer also warns and waits 10 seconds if it sees an open connection.

```sh
bash deploy/hermes/install-forward.sh
```

It is safe to re-run. In order, it:

1. Checks that whatever holds 8642 and 8643 is NemoClaw's forward with exactly the unit's command. If not, it stops before changing anything.
2. Installs `forward-adopt.sh`, both forward units, the watchdog unit (now `KillMode=process`) and `/etc/sudoers.d/aircheck-forward`. This sudo rule allows `user` to restart the two forward units and nothing else, and it is checked with `visudo` first.
3. Stops the unsupervised forwards and starts both units. A unit that already owns its port is left running (not restarted).
4. Reinstalls the watchdog script (`install-watchdog.sh`, with its dry run).
5. Re-applies the agent config (`apply-agent-config.sh`, without `--with-skills`; it does not touch the installed skills). For `airc` this re-confirms values already set. **For the demo agent it is a real change:** on Oct 29 `aircdemo` had `creation_nudge_interval: 15` and `write_approval: false`. After this, the demo agent's skill writing is turned off too, and the installer prints "aircdemo (demo agent): skill writing turned off".
6. Prints the checks: `/health` 200 on each port, `ActiveState`, `NRestarts` and `MainPID` for each unit, and the `ss -ltnp` line for each port. The listener's PID must be the unit's `MainPID`. It ends with "All checks passed." or a `FAIL:` line.

**Prove it restarts:** `bash deploy/hermes/install-forward.sh --test` does everything above, then kills each forward's main process once. Each port must answer `/health` 200 within 10 seconds, and `NRestarts` must go up by exactly 1.

Check by hand later:

```sh
systemctl show aircheck-hermes-forward -p ActiveState -p NRestarts -p MainPID
ss -ltnp 'sport = :8642'                     # the pid must be the MainPID above
nemohermes airc recover                      # should report the forward as fine, and leave the PID unchanged
```

After installing, watch `journalctl -u aircheck-hermes-forward -f` for a minute while the watchdog or a draft uses the link, and check that it does not log a line per connection. If it does, that noise is the forward's own output, not a fault. A rising `NRestarts` means the forward keeps dropping. Each restart costs about a second, not hours, but it is worth a look in the same journal.

## aircdemo (the judges' sandbox)

The demo workspace has its own Hermes sandbox, `aircdemo`, so a judge's chat or draft never runs in the sandbox that holds Tarik's real work. Decision 013 has the reasoning.

- **Onboarding:** `~/.aircheck/onboard-demo.sh`. It passes the model key only (no Telegram, no Tavily), uses `--fresh`, puts the dashboard on port 18790 and the Hermes API on `127.0.0.1:8643` (loopback only, like the real one on 8642).
- **Memory is off** (ruling R22), so nothing one judge says is remembered for the next. Inside the sandbox:

  ```sh
  openshell sandbox exec -n aircdemo -- bash -lc "hermes config set memory.memory_enabled false && hermes config set memory.user_profile_enabled false"
  ```

  The real sandbox `airc` keeps its memory on.
- **Bridge tools.** The demo sandbox gets the same Crate tools with the same deny list, and its own `aircheck` route that submits into the demo workspace:

  ```sh
  export CRATE_MCP_TOKEN="$(grep ^CRATE_MCP_TOKEN= ~/.aircheck/bridge.env | cut -d= -f2-)"
  export AIRCHECK_DEMO_MCP_TOKEN="$(grep ^AIRCHECK_DEMO_MCP_TOKEN= ~/.aircheck/bridge.env | cut -d= -f2-)"
  nemohermes aircdemo mcp add crate --url https://10.104.0.41:8443/crate/mcp --env CRATE_MCP_TOKEN --trusted-private-host 10.104.0.41 --deny-tool "telegraph_*" --deny-tool "tumblr_*" --deny-tool "browser_*" --deny-tool "whosampled_*" --deny-tool bandcamp_get_fan_collection --deny-tool bandcamp_get_artist_page --deny-tool bandcamp_get_album --deny-tool bandcamp_get_artist_tracks --deny-tool bandcamp_get_bandcamp_editorial
  nemohermes aircdemo mcp add aircheck --url https://10.104.0.41:8443/aircheck-demo/mcp --env AIRCHECK_DEMO_MCP_TOKEN --trusted-private-host 10.104.0.41
  ```

- **The bridge token pair.** `~/.aircheck/bridge.env` holds `AIRCHECK_DEMO_MCP_TOKEN` (what the demo sandbox presents to the bridge) and `DEMO_AGENT_SUBMIT_TOKEN` (what the bridge presents to Convex for demo submits; it must equal the Convex env var of the same name). Set both or neither: with neither, the `/aircheck-demo/mcp` route does not exist.
- **The relay** reads `AIRCDEMO_GATEWAY_TOKEN` from `~/.aircheck/relay.env` (from `nemohermes aircdemo gateway-token --quiet`). Empty means the relay skips the demo sandbox.
- **Its own boot unit**, `/etc/systemd/system/aircheck-hermes-demo.service` (repo copy: `deploy/hermes/aircheck-hermes-demo.service`). It starts after `aircheck-hermes.service`, retries `recover` the same way, has its own 15-minute start limit, and stops `aircdemo` cleanly at shutdown. Every step is non-fatal. Because it is a separate unit, a slow or broken demo can never time out the real unit and stop `airc`. Install: `sudo cp aircheck-hermes-demo.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable aircheck-hermes-demo`, and remove the old demo lines from the installed `aircheck-hermes.service` by copying the repo version over it.
- Check: `nemohermes aircdemo status` (Ready) and `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8643/health` (200).

### Before judges are told the demo is live (ruling R23)

All of these run on prod, after the merge and a console redeploy:

- [ ] A demo chat answers, and is labelled "Live · Nemotron".
- [ ] A demo draft creates a `demo-…` package (with its five-character suffix) and no `pkg-…` row.
- [ ] The 6th run in 10 minutes from one session is refused with the plain "Demo limit reached" message.
- [ ] With `DEMO_LIVE=0` on Convex, a demo run is labelled "Sample · scripted". Set it back afterwards.
- [ ] Re-record a live demo run of the 10-2-26 draft as the scripted events, replacing the 10-9-26 placeholder in `apps/console/convex/scriptedEvents.ts`.
- [ ] After a "remember this" chat, the demo sandbox's memory is still empty.
- [ ] A manual check of /chat and /tracklist at 375 px wide in a real browser.

## The watchdog

A timer checks every five minutes that the agent side is up, and texts Tarik on Telegram when something is not.

- `/etc/systemd/system/aircheck-watchdog.timer` runs `~/.aircheck/watchdog.sh` (repo copy: `deploy/hermes/watchdog.sh`) 3 minutes after boot and then every 5 minutes.
- It runs nine probes (since Plan 5c, Oct 28):
  - `Hermes` and `Demo Hermes`: `http://127.0.0.1:8642/health` and `http://127.0.0.1:8643/health`.
  - `Crate bridge`: `https://10.104.0.41:8443/healthz`.
  - `Relay`, `Media` and `Publisher`: `systemctl is-active` on each service.
  - `Agent tools` and `Demo agent tools`: `nemohermes <sandbox> mcp status` for `aircheck` and `crate` must say registered. This catches the "mismatch" problem described under "The Hermes sandbox".
  - `Agent skills`: `COLUMNS=200 hermes skills list --source local` (one `openshell sandbox exec` per sandbox) must include `rlr-description-safety` in both sandboxes. The listing is saved as `~/.aircheck/skills-list.<sandbox>` for the next check, so each run asks the gateway only once per sandbox. `COLUMNS=200` matters: at the default width the table cuts names short (`rlr-mixcloud-title-and…`).
  - `Hermes forward` and `Demo Hermes forward`: `systemctl is-active` on `aircheck-hermes-forward` and `aircheck-hermes-demo-forward`. A stopped unit alerts once, like any other probe.
- **New agent-made skills.** It also reads the skill listing that the `Agent skills` probe saved. Any `local` skill that `install-skills.sh` did not install gets one Telegram line: "Air Check: the agent made itself a new skill, <name>, in <sandbox>. Check it before the next draft." Each sandbox-and-name pair alerts once. They are remembered in `~/.aircheck/watchdog.skills-seen` (delete a line to be told again). The allowed list in `watchdog.sh` must match `SKILLS` in `install-skills.sh`, and a test checks this.
- Earlier copies of the script are kept on the VM as `~/.aircheck/watchdog.sh.pre-4b`, `watchdog.sh.pre-plan5` and `watchdog.sh.pre-5c`.
- When something goes down it sends one message: "Air Check: <name> is down since HH:MM. Console unaffected." When everything is back it sends one more. Otherwise it says nothing. During the Oct 28 reboot test it reported Demo Hermes and both tool probes down while the sandboxes booted, then "everything is back up at 21:02" (UTC on the VM clock), which is expected.
- Auto-heal: when `Hermes` or `Demo Hermes` fails, the watchdog first restarts that port's forward unit (`sudo -n systemctl restart --no-block aircheck-hermes-forward.service`, or the demo one, allowed by the sudo rule `install-forward.sh` installs). It waits about 10 seconds and probes again. If the probe still fails, it runs `nemohermes airc recover` (or `aircdemo`) once, waits about 10 seconds and probes again. Only a failure after that counts as down. The unit has `KillMode=process`, so a forward that `recover` starts survives the end of the run. Before Oct 29 systemd killed it about 11 seconds after the "reconnected" message. A successful heal sends one Telegram line, "Air Check: agent link dropped and was reconnected at HH:MM.", and writes `watchdog: <probe> link dropped, reconnected at HH:MM` to the journal (`journalctl -u aircheck-watchdog`). `--dry-run` prints what it would run and runs nothing. To deploy a new copy: `git pull` in `~/air-check`, then `bash ~/air-check/deploy/hermes/install-watchdog.sh` (keeps `watchdog.sh.bak`).
- It remembers what it last saw in `~/.aircheck/watchdog.state`. Messages that could not be sent wait in `~/.aircheck/watchdog.pending` and go out with the next successful send.
- To test without sending a message: `~/.aircheck/watchdog.sh --dry-run` prints what it would send. Run it after every change to the script: the first version of the `Agent tools` probe crashed the script on the VM for a few minutes (see `docs/FRICTION_LOG.md`, Oct 28).

## The bridge

The bridge is a small program that sits between Hermes and two things Hermes may not touch directly: the Crate research tools and the app's "submit a package" route. Hermes can only speak to remote tools over HTTPS with one bearer token (a secret string sent with each request), so the bridge provides exactly that. Decision 006 has the reasoning.

**Why it is a host process, not a container.** The VM's firewall (ufw) protects ports on the host. Ports that Docker publishes skip ufw. Running the bridge under systemd on the host means one firewall rule decides who can reach it.

- **Code:** `apps/bridge` in this repo, running from `~/aircheck-bridge` on the VM. The research tools come from `crate-cli`, cloned at `~/crate-cli` (commit `37f4ec2`, built with `npm ci && npm run build`). It has no LICENSE, so we call it and never copy it into this repo.
- **Service:** `/etc/systemd/system/aircheck-bridge.service` (repo copy: `deploy/bridge/aircheck-bridge.service`). Logs: `journalctl -u aircheck-bridge`. It logs one line per call, such as `tool=<name> ok=<bool> ms=<n>`, and never the arguments.
- **Settings:** `~/.aircheck/bridge.env` (mode 600). The variable names are in `deploy/bridge/bridge.env.example`.
- **Address:** it listens only on the VM's private address `10.104.0.41`, port 8443. The endpoints are `/crate/mcp` (16 tools), `/aircheck/mcp` (three tools: `package_submit`, `package_revise` and the read-only `package_get`; since Plan 5c, Oct 28) and `/healthz`. The demo route `/aircheck-demo/mcp` has the same three, writing only to the demo workspace.
- **Which Crate tools Hermes gets:** MusicBrainz (6), Wikipedia (3), Bandcamp (3: `search_bandcamp`, `discover_music`, `get_tag_info`) and iTunes (4). `bandcamp_get_fan_collection` is blocked by name (Hard Rule 13). The four Bandcamp tools that take a page URL (`bandcamp_get_artist_page`, `bandcamp_get_album`, `bandcamp_get_artist_tracks`, `bandcamp_get_bandcamp_editorial`) are blocked too (Hard Rule 5: enrich by artist and title, never by following URLs). Relaxing this needs Tarik to record an exception in decision 006, ARCHITECTURE 3.7 and Hard Rule 5. Crate ships with built-in keys, so Discogs, Last.fm and Ticketmaster would work too, but the bridge's allow-list hides them. Tarik chose keyless sources only for now. Widening is a one-line change to the allow-list.
- **Links are limited (defence in depth).** Any `url` argument must be https on `bandcamp.com` or `*.bandcamp.com`. Crate makes those fetches from the host, outside the sandbox's network rules, so the bridge has to enforce this itself.

**Firewall.** Only the sandbox network may reach the bridge:

```sh
SUBNET=$(docker network inspect openshell-docker -f '{{(index .IPAM.Config 0).Subnet}}')
sudo ufw allow from "$SUBNET" to 10.104.0.41 port 8443 proto tcp
```

`openshell-docker` is the sandbox's Docker network. Docker picks its subnet when the network is created, so look it up rather than typing it (on the current VM it is `172.18.0.0/16`). The private address is translated (NAT) from the public IP, so this rule is the only thing keeping the bridge off the internet. Checked from the Mac: port 8443 times out, while port 443 connects as a control.

### If the private address changes

It has not changed across three reboots, but if it ever does (say `<new ip>`):

1. Make a new leaf certificate: `deploy/bridge/make-leaf.sh <new ip>`.
2. Edit `BRIDGE_HOST` in `~/.aircheck/bridge.env`.
3. Edit the probe IP in `~/.aircheck/watchdog.sh`.
4. Replace the ufw rule: `sudo ufw status numbered`, delete the old 8443 rule by number, and add it again as under "Firewall" with the new address.
5. `sudo systemctl restart aircheck-bridge`.
6. `nemohermes airc mcp remove crate` and `mcp remove aircheck`, then both `mcp add` commands below with the new URL and `--trusted-private-host <new ip>`.

### After a Node upgrade (nvm)

The units (`aircheck-bridge.service`, `aircheck-hermes.service`, `aircheck-hermes-demo.service` and `aircheck-relay.service`) hard-code `/home/user/.nvm/versions/node/v22.23.4`. After an nvm Node upgrade, edit each unit to the new folder, then `sudo systemctl daemon-reload` and restart them.

### Registering the bridge with Hermes

Export only the two tokens from `bridge.env` (not the whole file), then run:

```sh
export CRATE_MCP_TOKEN="$(grep ^CRATE_MCP_TOKEN= ~/.aircheck/bridge.env | cut -d= -f2-)"
export AIRCHECK_MCP_TOKEN="$(grep ^AIRCHECK_MCP_TOKEN= ~/.aircheck/bridge.env | cut -d= -f2-)"
nemohermes airc mcp add crate --url https://10.104.0.41:8443/crate/mcp --env CRATE_MCP_TOKEN --trusted-private-host 10.104.0.41 --deny-tool "telegraph_*" --deny-tool "tumblr_*" --deny-tool "browser_*" --deny-tool "whosampled_*" --deny-tool bandcamp_get_fan_collection --deny-tool bandcamp_get_artist_page --deny-tool bandcamp_get_album --deny-tool bandcamp_get_artist_tracks --deny-tool bandcamp_get_bandcamp_editorial
nemohermes airc mcp add aircheck --url https://10.104.0.41:8443/aircheck/mcp --env AIRCHECK_MCP_TOKEN --trusted-private-host 10.104.0.41
```

For a registration that already exists, update the deny list in place (the bridge hides these tools anyway; this is the second lock):

```sh
nemohermes airc mcp update crate --deny-tool "telegraph_*" --deny-tool "tumblr_*" --deny-tool "browser_*" --deny-tool "whosampled_*" --deny-tool bandcamp_get_fan_collection --deny-tool bandcamp_get_artist_page --deny-tool bandcamp_get_album --deny-tool bandcamp_get_artist_tracks --deny-tool bandcamp_get_bandcamp_editorial
```

Check it:

```sh
nemohermes airc mcp status crate --json --tools     # expect ready, and trustedPrivateTarget.state "match"
```

Re-run both `mcp add` commands after any re-onboard (see the Hermes section for the unverified part). For `airc`, `deploy/hermes/reonboard-without-tavily.sh` does it.

### Updating the bridge

1. On the Mac: `pnpm --filter @aircheck/bridge build && pnpm --filter @aircheck/bridge deploy --prod --legacy <dir>` (a self-contained bundle in `<dir>`).
2. Pack it: `COPYFILE_DISABLE=1 tar -C <dir> --exclude ./test --exclude ./src -czf bridge.tgz .` (the variable stops macOS adding hidden metadata files).
3. Copy it with ssh and `cat`: `ssh user@<the VM's static IP> 'cat > /tmp/bridge.tgz' < bridge.tgz`
4. On the VM: `tar -xzf /tmp/bridge.tgz -C ~/aircheck-bridge && rm /tmp/bridge.tgz`. Tar warnings about `LIBARCHIVE.xattr` headers are harmless.
5. `sudo systemctl restart aircheck-bridge`, then check `curl -s --cacert ~/.aircheck/ca/ca.crt https://10.104.0.41:8443/healthz` (expect `ok`), `journalctl -u aircheck-bridge -n 20`, and the watchdog's `--dry-run`.

`scp` and `rsync` mangled the paths on this setup (see `docs/FRICTION_LOG.md`); use ssh and `cat` as above.

### Apple Music catalog (Plan 7, ruling R6)

`source_search` with `source: "apple_music"` looks a release up in Apple's catalog (release date, label, the ℗ line, UPC or ISRC, and the `music.apple.com` page). Never audio, previews or artwork. The bridge signs its own short-lived token from the MusicKit key; the agent never sees the key or the token. The same Convex check as web search runs first, so an embargoed release is never sent to Apple either (R2). Without the three settings, with only one or two of them, or with a key file the bridge cannot use, the bridge still starts and that option says Apple Music is not configured. The log says which: `apple_music=available` when the key loaded; otherwise `apple_music=unavailable` with `reason=partial_config missing=<names>`, `reason=key_unreadable`, or `reason=key_not_p256` (a readable key that is not the P-256 kind MusicKit signs with).

The keys go in with `deploy/bridge/add-research-keys.sh` (see "Plan 7: sourced research" below). It also copies `TAVILY_API_KEY`, never shows a value, and never adds a second line for a name.

### Where the agent's submit goes

Hermes calls `package_submit`, and the bridge posts to the app's `POST /agent/packages` route on Convex with a token called `AGENT_SUBMIT_TOKEN` (decision 011). A person still has to approve the package in the console. Since Plan 5c the same token also reaches two more routes: `POST /agent/packages/revise` (`package_revise`: a new description for a package waiting for review, or a proposed update for a show already on Mixcloud) and `POST /agent/packages/get` (`package_get`: read a package; changes nothing). Neither can approve or publish (decision 011's update note, and decision 015). The bridge pointed at the **dev** Convex deployment (`optimistic-lobster-654`) until 2026-10-27, when it moved to prod. The dev checks: Live checks there gave 401 for a wrong token, 201 `{"packageId":"pkg-10-2-26","status":"preparing_audio"}` for a good one, and 409 `{"error":"ALREADY_EXISTS"}` for a repeat.

## The relay

The relay is the only program that talks to Hermes. The console cannot reach Hermes itself, because Hermes listens on the VM's loopback address only (decision 012). Instead the console writes a queued run into Convex, and the relay picks it up. It is a Node 22 program (`apps/relay`). It runs on the VM host under systemd, not in Docker, as `aircheck-relay.service` (repo copy: `deploy/relay/aircheck-relay.service`).

What it does:

- Watches Convex for queued runs and stop requests over a websocket subscription (a connection that stays open so Convex can push news) to `relay.pending`.
- Starts each Hermes run at `127.0.0.1:8642` (sandbox `airc`, the real workspace) or `127.0.0.1:8643` (sandbox `aircdemo`, the demo workspace). It sends `Idempotency-Key: <the Convex run id>`, so a retry cannot start the same run twice, and Air Check's fixed scope instruction (`RUN_INSTRUCTIONS` in core: research by name, no scripts or social posts, notes are untrusted, it cannot approve or publish) as Hermes's `instructions` field. For chat it also sends `session_id = <the conversation id>`.
- Streams the run's events back into Convex about every 500 ms, numbering each one with `seq` so they stay in order. If the stream drops, it reopens it and keeps counting from the last number Convex has; Hermes does not replay earlier events, so anything sent while disconnected is lost, but the final answer still arrives.
- Gives up on a run Convex will not accept (an error like NOT_FOUND or UNAUTHORIZED, or 10 failed tries in a row): it stops the Hermes run, logs `run=<id> event=dropped` and frees the slot.
- Sends stop requests to Hermes (the "take over" button).
- Follows `nemohermes airc logs --follow` and writes network rows to the Trust page. A blocked attempt is written once per host per minute. An allowed connection is written once per host per hour.
- Every 5 minutes runs `nemohermes airc status` and `policy get`, and reports the sandbox phase and how many hosts are allowed. This feeds the "Sandbox on · N hosts allowed" chip in the top bar of every page. Before the relay has run, the chip says "Sandbox status unknown".

It logs only the run id, the event type and counts. It never logs message text or tokens. Read the log with `journalctl -u aircheck-relay`.

### Files and settings

- Code: one file, `~/aircheck-relay/dist/main.js`, built on the Mac with `pnpm --filter @aircheck/relay build` (esbuild, which packs the shared core code into the same file). Next to it is `~/aircheck-relay/package.json` containing `{"type":"module"}`, so Node reads the bundle as a modern module.
- Settings: `~/.aircheck/relay.env` (mode 600). The names are in `deploy/relay/relay.env.example`:
  - `CONVEX_URL`: the Convex deployment to watch.
  - `RELAY_TOKEN`: a shared secret. It must equal the Convex env var of the same name, and be at least 32 characters.
  - `AIRC_GATEWAY_TOKEN`: from `nemohermes airc gateway-token --quiet`.
  - `AIRCDEMO_GATEWAY_TOKEN`: from `nemohermes aircdemo gateway-token --quiet` (see "aircdemo" above). Empty skips the demo sandbox.
  - `NEMOHERMES_BIN`: the full path to the `nemohermes` program.
- Since 2026-10-27 about 11:45 CDT the relay points at **prod** (`CONVEX_URL=https://clever-deer-759.convex.cloud`). The dev settings are kept as `~/.aircheck/relay.env.dev-backup`.

### Install (first time)

```sh
sudo cp aircheck-relay.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/aircheck-relay.service
sudo systemctl daemon-reload && sudo systemctl enable --now aircheck-relay
```

### Updating the relay

1. On the Mac: `pnpm --filter @aircheck/relay build`.
2. Copy the bundle with ssh and `cat`, not `scp` or `rsync`, which mangled the paths on this setup (see `docs/FRICTION_LOG.md`): `ssh user@<the VM's static IP> 'cat > ~/aircheck-relay/dist/main.js' < apps/relay/dist/main.js`
3. On the VM: `sudo systemctl restart aircheck-relay`.
4. Check `journalctl -u aircheck-relay -n 20`. Expect `status sandbox=airc phase=Ready hosts=10` and no `ok=false`.

### Hardening, and why home must be writable

The unit sets `ProtectSystem=strict` (the whole filesystem is read-only to the relay), `ProtectHome=read-only` plus `ReadWritePaths=/home/user` (other users' homes stay read-only; only `/home/user` is writable), `NoNewPrivileges` and `PrivateTmp`. Home has to stay writable because `nemohermes` creates a lock folder, `~/.nemoclaw-portable-host.lock`, on every call. Checked on the VM with `systemd-run`: a fully read-only home fails with EROFS (the "read-only file system" error), and `ProtectHome=read-only` with `ReadWritePaths=/home/user` works.

### Convex settings the relay needs

`RELAY_TOKEN` is set on both dev and prod, with different values. Every `relay.*` Convex function takes it as its first argument and fails closed (refuses the call) if the env var is missing or short. Set it from the Mac the same way as the other env vars: `npx convex env set RELAY_TOKEN <value>` in `apps/console`. `DEMO_AGENT_SUBMIT_TOKEN` is set on prod (it must equal the bridge's value). `DEMO_RUNS_PER_SESSION` (default 5 per 10 minutes), `DEMO_LIVE_RUNS_PER_DAY` (default 40) and `DEMO_LIVE` (0 forces scripted replies) are optional and unset, so the defaults apply.

## The media service (the audio inbox)

The media service (`apps/media`, unit `deploy/media/aircheck-media.service`) joins each show's two hour WAVs into the one MP3 that Tarik previews and Mixcloud gets. Audio arrives by copying the two WAVs into `~/aircheck-audio/inbox/<YYYY-MM-DD>/`, one folder per show date. Name the two files so their numbers sort in hour order (`1-hour.wav`, `2-hour.wav`), or give neither a number; a mix of the two is refused rather than guessed. The unit creates `~/aircheck-audio/inbox` and `~/aircheck-audio/prepared` before it starts.

Copy each WAV under a temporary name and rename it only once the copy has finished, so the service never sees a half-copied file. Use ssh and `cat`, as for the relay:

```sh
ssh user@<the VM's static IP> 'mkdir -p ~/aircheck-audio/inbox/2026-10-02 && cd ~/aircheck-audio/inbox/2026-10-02 && cat > 1-hour.wav.part && mv 1-hour.wav.part 1-hour.wav' < 1-hour.wav
```

The `mv` runs only if `cat` finished (`&&`). A dropped connection leaves a `.part` file, which the service ignores; copy again. As a second guard, the service also waits until a WAV's header says the whole file is there and nothing has written to it for 2 minutes. Until then the Today page says "<date> is still copying (or the copy is incomplete)". Why: ffmpeg turns a cut-off WAV into a short MP3 without complaint, and that short show would have gone up.

### Files, settings and limits

- Code: `~/aircheck-media/dist/main.js`, built on the Mac with `pnpm --filter @aircheck/media build` (one esbuild file, like the relay). Service: `aircheck-media.service` (repo copy: `deploy/media/aircheck-media.service`). Logs: `journalctl -u aircheck-media`.
- Settings: `~/.aircheck/media.env` (mode 600), names in `deploy/media/media.env.example`: `CONVEX_URL`, `MEDIA_TOKEN` (must equal the Convex env var of the same name, at least 32 characters), `INBOX_DIR`, `PREPARED_DIR`, and the optional `POLL_MS` (default 30 seconds between scans).
- ffmpeg must be on the VM (`sudo apt-get install -y ffmpeg`; 6.1.1 was installed on Oct 28).
- At most 3 prepared MP3s wait on disk at once (`MAX_PREPARED`). A fourth show waits, and the Today page names what holds the slots. An MP3 and its inbox folder are deleted once the show is on Mixcloud.
- If an encode fails, the service waits 10 minutes before trying that show again, so a bad file cannot keep the VM busy re-encoding two hours of audio.
- The first real show (10-2-26, Oct 28) took 99 seconds to encode: 171.6 MB at 192 kbps, 7150.08 seconds long (3585.14 + 3564.90).

## The publisher

The publisher (`apps/publisher`, unit `deploy/publisher/aircheck-publisher.service`) is the only program that uploads to Mixcloud. Decision 014 has the reasoning.

What it does:

- Every 30 seconds it reads the queue of packages Tarik approved, and uploads the oldest show first, at most 3 per America/Chicago day. A 4th approved show waits for the next day; the package page says when it will post.
- Before uploading it re-hashes the MP3 and compares it with the one Tarik approved. If the file changed or is missing, it uploads nothing and marks the package failed (`audio_changed` or `audio_missing`).
- It streams the MP3 from disk, with the title, tags, description, tracklist (as Mixcloud "sections": artist and song only, no times) and the cover: the package's own cover if Tarik picked one, else the station's standard cover (`STANDARD_COVER_STORAGE_ID` in Convex).
- It never retries an upload whose outcome it cannot know (see "When a publish goes wrong"). A Mixcloud rate limit before anything was accepted is waited out and retried once.
- It sends Tarik a Telegram "ready to review" card for each package waiting for review. The card is only a link to the package page; it cannot approve anything.
- It pushes approved description updates to shows already on Mixcloud (see "Description updates" below).

It logs package ids, step names, `ok=true/false` and timings, never descriptions or tokens: `journalctl -u aircheck-publisher`.

### Files and settings

- Code: `~/aircheck-publisher/dist/main.js`, built on the Mac with `pnpm --filter @aircheck/publisher build` (one esbuild file). The bundle is a modern (ESM) module, so like the relay it needs `~/aircheck-publisher/package.json` containing `{"type":"module"}`.
- Settings: `~/.aircheck/publisher.env` (mode 600), names in `deploy/publisher/publisher.env.example`:
  - `CONVEX_URL`, and `PUBLISHER_TOKEN` (must equal the Convex env var of the same name, at least 32 characters; a different value from `MEDIA_TOKEN`).
  - `APP_URL`: the console's public address, for the Telegram card's link.
  - Optional, with defaults: `MIXCLOUD_TOKEN_FILE` (`~/.aircheck/mixcloud/token.json`), `PREPARED_DIR` (`~/aircheck-audio/prepared`), `STATE_FILE` (`~/.aircheck/publisher/state.json`), `AIRC_SECRETS_FILE` (`~/.airc/secrets.env`, where it reads only the Telegram bot token and Tarik's chat id) and `POLL_MS` (30 seconds).
- On Convex prod: `PUBLISHER_TOKEN`, `MEDIA_TOKEN` and `STANDARD_COVER_STORAGE_ID` (the standard cover, uploaded to Convex storage on Oct 28: Tarik's `3-red-rings.png`, 3000 by 3000 pixels).
- What it may touch: the unit makes the whole disk read-only to it except one folder, `~/.aircheck/publisher`, where it keeps a small state file (which Telegram cards it already sent, and a hash of a Mixcloud key that was refused). It reads, but cannot change, the prepared MP3s, the Mixcloud token file and `~/.airc/secrets.env`. It cannot write anywhere else in `~/.aircheck`, which holds every service's settings and the bridge's private CA key.

### Install (first time)

1. On a new VM, create the state folder once by hand: `install -d -m 0700 ~/.aircheck/publisher`. (The unit also creates it before each start, but see the lesson below.)
2. `mkdir -p ~/aircheck-publisher/dist`, write the `package.json` above, and copy the bundle with ssh and `cat` as for the relay: `ssh user@<the VM's static IP> 'cat > ~/aircheck-publisher/dist/main.js' < apps/publisher/dist/main.js`
3. Create `~/.aircheck/publisher.env` (mode 600) from the example.
4. `sudo cp aircheck-publisher.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now aircheck-publisher`
5. Connect Mixcloud from the console's Settings page (see "The Mixcloud token folder"). Until then the publisher reports "not connected" and approved shows wait.

**The `-` in `ReadWritePaths` is load-bearing.** The unit's `ReadWritePaths=-/home/user/.aircheck/publisher` starts with a dash. On Oct 28 the publisher's first start failed with status `226/NAMESPACE`: systemd builds the service's private view of the disk before running any start step, and that fails if a folder named in `ReadWritePaths` does not exist yet. The `ExecStartPre=+…install -d…` line that creates the folder runs only after that, so it could not help. The dash tells systemd to skip a missing folder instead of failing. The media unit has the same dash for `~/aircheck-audio`. Keep the dash in both, and create the folders by hand on a new VM anyway.

### The unlisted test (`--unlisted-test`)

`node dist/main.js --unlisted-test <packageId>` uploads one approved package to Mixcloud as unlisted (only people with the link can see it), outside the queue. It reads only packages already approved, forces unlisted, never marks the package as published, and refuses a package that is not in the approved queue. Any other arguments (a typo such as `--unlisted-test=<id>`) print the usage and exit before anything starts, so a typo cannot start the full service.

It does not stop the service for you. **Stop the service first**, or the service may upload the same package publicly at the same time:

```sh
sudo systemctl stop aircheck-publisher
cd ~/aircheck-publisher && ( set -a; . ~/.aircheck/publisher.env; set +a; node dist/main.js --unlisted-test pkg-M-D-YY )
```

Check the show on Mixcloud. When the service starts again it uploads the same package publicly (the test did not mark it published), so delete the unlisted copy on Mixcloud. This test was built but not run: on Oct 28 Tarik approved 10-2-26 before the test, and it went straight out publicly (`docs/SPIKES.md`, V5).

### When a publish goes wrong

The package page says what happened and offers the next step. The states:

- **`outcome_unknown`: "We don't know if it posted. Check Mixcloud before doing anything."** The upload was cut off (the service stopped or crashed, a timeout, a Mixcloud server error, or a reply Air Check could not read). It is never retried on its own, because a retry could post the show twice. Look on Mixcloud (the page links to the account's profile), then either:
  - **It's on Mixcloud:** paste the show's address (it must start `https://www.mixcloud.com/`) and press "It's on Mixcloud". The package becomes published with that address as its receipt. Paste the exact show address: description updates later use it.
  - **It isn't:** press "It isn't — reopen". The package goes back to review; Tarik approves it again.
  An unknown outcome counts toward the day's 3 uploads, in case it did post.
- **`failed`:** nothing was sent, or Mixcloud refused it. The page names the reason (for example "The MP3 changed after approval" or "Mixcloud asked us to slow down twice"). Press "Reopen for review" and approve again. For an MP3 problem the button is "Reopen and rebuild the MP3": the package goes back to waiting for audio and the media service rebuilds the MP3 from the inbox folder, which is still there because nothing posted.
- **`needs_reconnect`:** Mixcloud refused the access token. Mixcloud checks the token before it accepts any audio, so nothing was posted: the package goes back to approved and waits. The refused token is never tried again, and Tarik gets one Telegram message. Fix: Settings, then Connect Mixcloud again. `invalid_token_file` means the token file could not be read; reconnecting rewrites it.
- **Not connected (`no_token`):** no token file. Approved shows wait until Mixcloud is connected.
- **Publishing paused (`cover_unavailable`, `bad_cover`):** the cover could not be fetched (it tries again by itself) or the standard cover is not an image Mixcloud takes (replace it).

Restarting the publisher during an upload is what produces `outcome_unknown`: on start, every package still marked "publishing" becomes `outcome_unknown`, never back to approved. So restart or update it only when nothing is publishing (see "Deploy order").

### Description updates (shows already on Mixcloud)

From Plan 5c (Oct 28) a published show's description can be changed. Only the description changes; the title, tags, cover and tracklist stay as they are. Decision 015 has the reasoning.

1. Tarik proposes a new text on the package page ("Update the description on Mixcloud"), or asks the agent in Chat, which proposes one with `package_revise`. Proposing changes nothing on Mixcloud. A package has at most one open proposal; a new one replaces it.
2. Tarik approves the exact text (signed in). If the proposal changed since he opened it, Approve is refused and he opens the latest.
3. The publisher sends the description alone to Mixcloud's edit address, `https://api.mixcloud.com/upload/<account>/<show>/edit/`. The address is built only from the show's own receipt link. A receipt link that is not exactly a Mixcloud show address (for example one with non-English letters in it) is refused as `bad_show_url` and nothing is sent.

The outcomes on the package page:

- **Pushed:** the new text is live. Both live edits on Oct 28 (14:41 and 15:52 CDT) logged `step=edit ok=true` and left the name, tags, length, cover and tracklist unchanged.
- **`retries_exhausted`:** Mixcloud did not answer after 3 tries (an edit is safe to resend). The old description is probably still up. Propose and approve again.
- **`unconfirmed`:** Mixcloud accepted the request without confirming it. The new description may already be live: check the show page before proposing again.
- **`not_published`:** the package is no longer marked as on Mixcloud. Nothing was sent.
- A refused Mixcloud token works as for uploads: the update goes back to approved, nothing was changed, and Tarik reconnects.

**An approved update cannot be withdrawn while Mixcloud is disconnected.** It waits, and goes out as soon as Mixcloud is connected again. To stop it, propose and approve a different text before reconnecting.

### Updating the publisher

1. Make sure nothing is publishing: no package page shows "Uploading to Mixcloud…" or "Updating on Mixcloud…", and `journalctl -u aircheck-publisher -n 20` shows no step in progress.
2. On the Mac: `pnpm --filter @aircheck/publisher build`.
3. On the VM, keep the old bundle: `cp ~/aircheck-publisher/dist/main.js ~/aircheck-publisher/dist/main.js.pre-<change>`.
4. Copy the new one with ssh and `cat` (as in Install), and check its size matches the Mac's (`wc -c`).
5. `sudo systemctl restart aircheck-publisher`, then `journalctl -u aircheck-publisher -n 20`.

## Agent skills

The station skills in `skills/` are instruction files the agent (Hermes) can load. Five are installed in both sandboxes: `rlr-description-safety` (how to write the public description, in Tarik's voice), `rlr-mixcloud-title-and-tags`, and since Plan 7 the research skills `rlr-show-notes`, `rlr-pre-air-verify` and `rlr-deep-dive`. Like the description skill, the research skills' text is also sent with each research run, so the agent cannot skip it.

- **Install or refresh:** `~/air-check/deploy/hermes/install-skills.sh` on the VM (an optional first argument is the repo folder; default `~/air-check`). For each sandbox and each skill it removes the old copy and installs the repo copy, because `nemohermes <sandbox> skill install` refuses to replace a skill with the same name. It ends with `skill list` and fails if the skills are missing.
- **When to run it:** after changing a skill. After any destroy and re-onboard of `airc` or `aircdemo`, run `apply-agent-config.sh --with-skills` instead. It re-applies the skill-writing lock and then runs this script. Skills live in `/sandbox/.hermes/skills/<name>` inside the sandbox. They survive stop and start and `rebuild`, but not a destroy (checked in the NemoHermes v0.0.137 docs on the VM, Oct 28).
- **Installed is not the same as used.** On Oct 28 the agent had the skill installed and never opened it (`docs/LEARNING-LOG.md`). So the description skill's text is also compiled into the code and sent with every draft request and every `package_get` result. A test fails if that copy drifts from `skills/rlr-description-safety/SKILL.md`, so after editing the skill, run `pnpm test`, then deploy Convex and the bridge (the two places that carry the copy) as well as running `install-skills.sh`.
- **The agent's own skill was removed.** On Oct 27 the agent wrote itself a skill, `mixcloud-package-submission`, that taught it wrong limits (`docs/FRICTION_LOG.md`, Oct 28). It was removed from `airc` on Oct 28; a backup is on the VM at `~/.aircheck/agent-skill-backup`. The sandbox config now has `skills.creation_nudge_interval: 0` and `skills.write_approval: true` (re-applied by `apply-agent-config.sh`), and the watchdog sends a Telegram alert when a new agent-made skill appears.
- The watchdog's `Agent skills` probe alerts if `rlr-description-safety` disappears from either sandbox.

## Deploy order (changes that touch Convex, the bridge and the publisher)

Some changes span several parts, and each part expects the newer version of the one before it. Deploy in this order:

1. **Convex first** (from the Mac, `npx convex deploy -y` as in "Convex production commands"). New routes, tables and functions must exist before anything calls them.
2. **The bridge**, then re-wire both sandboxes so the agent sees the new tool list: `nemohermes airc mcp restart` and `nemohermes aircdemo mcp restart`. Check with `nemohermes airc mcp status aircheck --json --tools` (and the same for `aircdemo`) that the tools are listed and registered.
3. **The ingest token folder, once, before the console rebuild that first mounts it** (Plan 6): `~/.aircheck/ingest-tokens`, owner 1000, group 1001, mode 2770, as in "The ingest token folder". Otherwise Docker creates the folder as root and Connect fails.
4. **The console** (`dc up -d --build`), and check `dc ps` says healthy.
5. **The publisher last, and only when nothing is publishing** (see "Updating the publisher").

Deploy from `main`, after the pull request is merged; a production deploy from an unmerged branch was blocked on Oct 28, and the PR route that followed is the normal path now. For multi-step changes on the VM, put the commands in a short script file, copy it over with ssh and `cat`, read it, and run it, rather than pasting a long one-line ssh command: long pasted one-liners broke on Oct 28 (`docs/FRICTION_LOG.md`).

## Plan 7: sourced research

Plan 7 adds show notes, pre-air verify and deep dives (decision 019). The agent searches through two bridge tools, `source_search` and `research_submit`; Convex checks every fact and writes the document. Web search (Tavily) moves out of the `airc` sandbox and into the bridge, so `TAVILY_API_KEY` lives in `~/.aircheck/bridge.env` only. Never put it back in a sandbox.

**Limits, counted in Convex per Chicago day and shown in Settings:** 100 web searches for the real workspace and 20 for the demo (Oct 29; Tavily pay-as-you-go, 2 credits per advanced search, so at most 240 credits a day). Apple Music catalog lookups: 60 real, 20 demo. Past a cap the tool tells the agent to finish with what it has and mark the rest could-not-verify.

**The Thursday and Friday check.** A Convex cron, `pre-air verify` in `apps/console/convex/crons.ts`, fires every hour and acts only at 9 am Chicago time on Thursdays and Fridays. It queues a pre-air verify for the next show (Air Check's own notes first, else the Paper notes), at most once per show date per Chicago day, and never for the demo. When a verify finishes, the publisher sends one Telegram line within a minute: "Pre-air verify · <show date> / <n> changes · <n> open / Open report: <link>". It carries counts and a link only, no buttons; nothing can be approved there. A Regenerate sends no second line.

### Deploy, in this order (after the PR is merged)

1. **Convex** (Mac, `apps/console`): `npx convex deploy -y`. It must go before the publisher: until then the publisher's research-card pass fails every minute (`step=research-cards ok=false`), though ready cards still go out.
2. **The bridge** (as in "Updating the bridge"), then its keys from the Mac:

   ```sh
   AIRCHECK_VM=user@<the VM's static IP> bash deploy/bridge/add-research-keys.sh '<path to AuthKey_XXXX.p8>'
   ```

   It copies `TAVILY_API_KEY` from `~/.airc/secrets.env` into `bridge.env` on the VM itself (the key never passes through the Mac), pipes `APPLE_MUSIC_TEAM_ID` and `APPLE_MUSIC_KEY_ID` from `~/.aircheck-local/applemusic.env`, writes the key to `~/.aircheck/bridge/AuthKey.p8` (mode 600) and sets `APPLE_MUSIC_KEY_FILE`. A name that already has a value is left alone. It restarts the bridge and prints only: one line count per name (expect 1 each), `bridge /healthz: ok`, and `apple_music=available`. Then on the VM: `nemohermes airc mcp restart` and `nemohermes aircdemo mcp restart`, and check that `nemohermes airc mcp status aircheck --json --tools` lists `source_search` and `research_submit` (the same for `aircdemo`).
3. **The relay** (as in "Updating the relay").
4. **The console**: `dc up -d --build`, then `dc ps` says healthy.
5. **The publisher**, when nothing is publishing (as in "Updating the publisher").
6. **The watchdog, then the skills** (VM, `~/air-check` after `git pull`): `bash deploy/hermes/install-watchdog.sh`, then `bash deploy/hermes/install-skills.sh`. The watchdog goes first because its list of station skills now includes `rlr-show-notes`, `rlr-pre-air-verify` and `rlr-deep-dive`; an older copy would report them as skills the agent made itself.
7. **Re-onboard `airc` without Tavily** (VM, as `user`, when no draft or research run is going): `bash deploy/hermes/reonboard-without-tavily.sh`. See the checklist below.

### Re-onboard checklist (`airc` and `aircdemo`)

From now on, rebuild `airc` only with `deploy/hermes/reonboard-without-tavily.sh`, never `~/.aircheck/reonboard.sh` by itself: `~/.airc/secrets.env` still holds `TAVILY_API_KEY` (the bridge's copy came from there), and a plain re-onboard would give the sandbox its own Tavily door back.

For `airc`, the script does all of this and stops with a plain message at the first problem:

1. **Preflight, changing nothing.** No open connection on 8642. The repo has the research skills. The installed watchdog equals the repo copy. `bridge.env` has both MCP tokens. `airc` shows `Phase: Ready` (the destroy needs it running; with `--from-error` this check is skipped, see "If the sandbox is in `Error` anyway"). `reonboard.sh` has the three edits below (secrets through a setting the script can point at a copy, no `NEMOCLAW_WEB_SEARCH_PROVIDER=tavily`, onboard with `--fresh`) and names Tavily nowhere. Then it asks you to type `rebuild` (run it inside `tmux` or with `nohup`; a dropped SSH session mid-rebuild is the riskiest moment), and looks at 8642 once more before it changes anything.
2. **Pause** the watchdog timer (and any watchdog run in progress), the relay and `aircheck-hermes-forward`. A `trap` starts them again if anything fails later. The demo forward and `aircdemo` are not touched.
3. **Back up** the sandbox's skills and Hermes config to `~/.aircheck/agent-skill-backup/airc-<date>-<time>.tgz`. With `--from-error`, an unreadable sandbox means no backup; it goes on (step 7 reinstalls skills and config from the repo).
4. **Re-onboard** through `~/.aircheck/reonboard.sh` with a temporary copy of `secrets.env` that has no `TAVILY_API_KEY` line (mode 600, deleted on exit; the original is not changed), and with `TAVILY_API_KEY` unset in the shell. Telegram and the model key are passed as before. Hermes in `airc` loses its memory, as with any re-onboard.
5. **Relay token.** If the new sandbox has a new gateway token, it updates `AIRC_GATEWAY_TOKEN` in `~/.aircheck/relay.env` (old file kept as `relay.env.pre-reonboard`). The value is never printed.
6. **MCP tools.** Removes `crate` and `aircheck`, deletes the leftover gateway providers `airc-mcp-crate` and `airc-mcp-aircheck` if `openshell --gateway nemoclaw provider list` shows them (see below), then adds `crate` (the exact command under "Registering the bridge with Hermes", with all nine `--deny-tool` flags) and `aircheck`, then `nemohermes airc mcp restart`. If an add fails, its output is shown, not hidden.
7. **Skills and the skill-writing lock:** `apply-agent-config.sh --with-skills` (sets and reads back `skills.creation_nudge_interval: 0` and `skills.write_approval: true` in both sandboxes, then reinstalls the five station skills).
8. **Restore:** starts `aircheck-hermes-forward` (it adopts or replaces the forward the onboard started; a forward under 30 seconds old is left until it is older, so this can take about half a minute), then the relay and the watchdog timer.
9. **Checks:** `nemohermes airc status` lists no `tavily` policy; `policy get` has no `_provider_airc_tavily_search` and no `api.tavily.com`; `mcp status crate` is registered with no mismatch; `mcp status aircheck --tools` lists `source_search` and `research_submit`; the skill list holds exactly the five station skills and no agent-made one; the two config values read back; `/health` on 8642 is 200. It ends with "All checks passed." Then send the Telegram bot a message and check it replies (by hand).

If anything stops it after the re-onboard step (step 4 on), it restores the forward, relay and watchdog and prints: "Run this script again (add --from-error if the sandbox is not Ready)." Do exactly that; never fall back to `~/.aircheck/reonboard.sh` by itself.

If the Tavily provider rule comes back after the re-onboard (from NemoClaw's saved registry), the script stops and prints it. Do not delete it by hand: send the output, and it goes in `docs/FRICTION_LOG.md` and decision 006's addendum first.

**Leftover gateway providers.** `destroy --no-cleanup-gateway` leaves two OpenShell gateway providers behind, `airc-mcp-crate` and `airc-mcp-aircheck` (type `nemoclaw-mcp-v1`). With a provider present but no policy, `nemohermes airc mcp add` refuses: "MCP add recovery for 'crate' found non-prefix partial state across the native adapter, policy, provider, and attachment. No source was changed." `nemohermes airc mcp remove crate --force` does not clear them ("No native MCP server 'crate' is configured"). The script deletes exactly those two names with `openshell --gateway nemoclaw provider delete <name>`, only when `provider list` shows them. By hand it is the same two deletes. Never touch `aircdemo-mcp-*`, `airc-telegram-bridge` or the `nemoclaw-custom-*` provider.

**Piping the script over ssh.** Every child command in the script reads `/dev/null`, so `ssh ... 'bash -s' < script` no longer loses its tail to a command that reads stdin. Running it inside `tmux` is still the better way.

**What `~/.aircheck/reonboard.sh` must look like (the script refuses before changing anything if not).** It is not in the repo. A live run on Oct 29 showed three edits are needed. Keep a copy first (`cp ~/.aircheck/reonboard.sh ~/.aircheck/reonboard.sh.pre-plan7`), then:

1. Read secrets through `. "${AIRC_SECRETS_FILE:-$HOME/.airc/secrets.env}"` instead of a fixed path. The script passes its Tavily-free copy that way.
2. Delete ` NEMOCLAW_WEB_SEARCH_PROVIDER=tavily` from the policy-tier export line. With the key gone, the onboard's "Revalidating Tavily Search configuration for sandbox recreation" step fails after `destroy`, and `airc` is left gone.
3. Run `nemohermes onboard --fresh --name airc ...`. Without `--fresh` the onboard resumes from the old registry, which is what asked for Tavily.

The script's STOP message prints a one-line `sed -i.pre-plan7 -E ...` that applies all three when the secrets path is written as `"$HOME/.airc/secrets.env"` (a test applies it to a copy of that file). If it names Tavily anywhere else (a preset list, say), take `tavily` out of that line by hand.

For `aircdemo` (after a destroy and `~/.aircheck/onboard-demo.sh`, which never passes a Tavily key): add both tools with the commands under "aircdemo (the judges' sandbox)", `nemohermes aircdemo mcp restart`, then `bash deploy/hermes/apply-agent-config.sh --with-skills`. Check by hand: `nemohermes aircdemo status` lists `pypi` only, `policy get` has no `api.tavily.com`, `mcp status aircheck --json --tools` lists `source_search` and `research_submit`, the skills are the five station skills, and `/health` on 8643 is 200. Its search still works: it goes through the bridge, capped at 20 a day.

### First searches in code (Oct 29 prefetch, branch `feat/research-prefetch`)

Show notes get each track's first web search run by the bridge, in parallel, before the agent writes (decision 022). The relay starts it as the run starts (`POST https://10.104.0.41:8443/aircheck/prefetch` or `/aircheck-demo/prefetch`, `{ job }`, with that route's MCP token; not an agent tool). If that call fails, the agent's first `first_search` or `research_submit` for the job starts it. `research_submit` refuses a show-notes track until the agent has read its `first_search` (unless that search failed, the cap ran out, or the track is embargoed). It touches Convex, the bridge, the relay and the agent's skill. Deploy in this order, after the show-notes rework (`feat/research-richer`) is deployed:

1. **Convex** (`npx convex deploy -y`). Adds the read-only `/agent/research-prefetch` route, `/agent/search-done`, the job id on the relay's pending rows, the optional `credits` field on `searchUsage`, and the new prompt and skill text. Convex first: everything after it calls these.
2. **The bridge** ("Updating the bridge" above), then `nemohermes airc mcp restart` and `nemohermes aircdemo mcp restart`. Check: `nemohermes airc mcp status aircheck --json --tools` (and `aircdemo`) lists `first_search`, and `curl -s -o /dev/null -w '%{http_code}\n' --cacert ~/.aircheck/ca/ca.crt -X POST -H "authorization: Bearer $AIRCHECK_MCP_TOKEN" -d '{"job":"rj-none00"}' https://10.104.0.41:8443/aircheck/prefetch` prints `204` (no such job: nothing to start).
3. **The relay.** Add to `~/.aircheck/relay.env` (see `deploy/relay/relay.env.example`): `BRIDGE_URL=https://10.104.0.41:8443`, `AIRCHECK_MCP_TOKEN` and `AIRCHECK_DEMO_MCP_TOKEN` (copy the values from the bridge's env file without printing them, e.g. `grep -E '^AIRCHECK_(DEMO_)?MCP_TOKEN=' ~/aircheck-bridge/bridge.env >> ~/.aircheck/relay.env`), and `NODE_EXTRA_CA_CERTS=/home/user/.aircheck/ca/ca.crt`. Then "Updating the relay" and `sudo systemctl restart aircheck-relay`. Without these lines the relay runs as before and the agent's first call starts the searches.
4. **The skill:** `git pull` on the VM, then `deploy/hermes/install-skills.sh`.
5. **Check on a real show:** start show notes and watch `journalctl -u aircheck-relay -u aircheck-bridge -f`. Expect `run=<id> event=prefetch n=1` from the relay, one bridge line `prefetch searches=<2 per track> ok=<n> failed=0 capped=0 timeouts=0 ms=<about 30000 for 28 tracks> credits=<2 x ok>` within a minute of the start, then `tool=first_search status=ok` lines. `tool=research_submit status=gated` means the agent tried to skip a first search and was sent back. Settings shows "… searches used today · <credits> credits". Time the job from start to done and write the before and after times in `docs/LEARNING-LOG.md`.

Rolling back: deploy the previous bridge, relay and Convex, and run `install-skills.sh` from the previous commit, together (the new prompt names a tool an old bridge lacks). Remove the four relay.env lines or leave them; an old relay ignores them.

## Plan 8: release radar

The release radar turns forwarded email into release records. AgentMail (an email service with its own inbox, `rhythmlab@agentmail.to`) receives the mail and calls the console's `/api/agentmail/inbound` route. The console only stores the cleaned email. The ingest worker reads it once a minute: Bandcamp emails by code, co-signs through the Token Factory model, and one allowlisted Bandcamp page fetch for the player. Nothing in this section ever prints a secret; values move by pipe from a file.

### The settings

Console (`~/.aircheck/console.env` on the VM; the names are in `deploy/console.env.example`):

| Name | What it is | Secret? |
|---|---|---|
| `INBOX_TOKEN` | The console's key for storing email in Convex. The same value is set in Convex env. 64 hex characters, never shared with another service. | yes |
| `AGENTMAIL_API_KEY` | Reads each listed sender's message back from AgentMail, for AgentMail's own sender verdict (and the body when the webhook left it out). Sends nothing. | yes |
| `AGENTMAIL_WEBHOOK_SECRET` | The webhook's signing secret (`whsec_...`). Unset means the route answers 503 and stores nothing. | yes |
| `RADAR_SENDERS` | Comma-separated addresses whose email is kept: `tarik@radiomilwaukee.org` and Bandcamp's sender address. Unset means every sender is refused. | no |

Ingest worker (`~/.aircheck/ingest.env`, names in `deploy/ingest/ingest.env.example`): `NEBIUS_API_KEY`, a Token Factory key named `aircheck-ingest-radar`, separate from the agent's so it can be revoked alone. Unset means co-signs are recorded as "Air Check's reader is not set up"; Bandcamp emails still parse.

Convex (production env): `INBOX_TOKEN`, the same value as the console's.

> **Set `RADAR_SENDERS` before turning on the Gmail forwarding filter.** An email that arrives while it is unset is stored as "ignored", with no body. It is still in AgentMail and Gmail, and the catch-up script (section 6) can store it again once the list is right.

**How the sender check works (ruling R12, 2026-10-29).** AgentMail does not pass on the raw `Authentication-Results` header. It checks SPF, DKIM and DMARC itself and gives its verdict as fields on the message. The console keeps an email only when the From address is on `RADAR_SENDERS` and AgentMail's verdict, read back from AgentMail's API with our key (never from the email), says DMARC passed for the From address's domain (or a parent domain), and the message is not labelled `unauthenticated`, `spam` or `blocked`. Otherwise Not added says "AgentMail could not confirm the sender". A stranger costs no AgentMail call.

### 1. Make the secrets on the Mac, without showing them

Why: each secret goes straight into a file and into Convex, so it never appears on screen or in shell history. Every append in this runbook first adds a newline if the file does not end with one (`[ -z "$(tail -c1 "$f")" ] || echo >> "$f"`). Without it, a file saved without a final newline would glue the new line onto its last one, and both settings would break.

```sh
cd apps/console
export CONVEX_DEPLOY_KEY=$(grep '^CONVEX_DEPLOY_KEY=' .env.production.local | cut -d= -f2-)
f=.env.production.local; [ -z "$(tail -c1 "$f" 2>/dev/null)" ] || echo >> "$f"   # newline guard, see above
t=$(openssl rand -hex 32); printf 'INBOX_TOKEN=%s\n' "$t" >> "$f"; npx convex env set INBOX_TOKEN "$t"; unset t
unset CONVEX_DEPLOY_KEY
```

For the Token Factory key: make a new key named `aircheck-ingest-radar` in the Token Factory console, then open `~/.aircheck-local/ingest-radar.env` in your editor and paste it as one line, `NEBIUS_API_KEY=<the key>`. Then `chmod 600 ~/.aircheck-local/ingest-radar.env`.

`AGENTMAIL_API_KEY` is already in `apps/console/.env.local`.

### 2. Deploy, in this order

Why the order matters: the new console calls Convex functions that only the new Convex has. **Deploying the console before Convex breaks the Today page and the package page** until Convex catches up. The bridge and the ingest worker also call new Convex functions, so Convex always goes first.

1. **Convex** (Mac, from `apps/console`, after the PR is merged and `main` is pulled). Why: new tables, fields and functions must exist before anything calls them.

   ```sh
   export CONVEX_DEPLOY_KEY=$(grep '^CONVEX_DEPLOY_KEY=' .env.production.local | cut -d= -f2-)
   npx convex deploy -y
   unset CONVEX_DEPLOY_KEY
   ```

2. **The bridge** (gives the agent the read-only `radar_get` tool). Why: the agent can then answer "What's new on the radar?". Follow "Updating the bridge" above, then on the VM:

   ```sh
   nemohermes airc mcp restart
   nemohermes aircdemo mcp restart
   nemohermes airc mcp status aircheck --json --tools   # radar_get should be listed
   ```

3. **The console.** Why: it holds the inbound webhook route and the Release radar page. First pipe the two secrets that exist so far (Mac, from `apps/console`):

   ```sh
   grep -hE '^(AGENTMAIL_API_KEY|INBOX_TOKEN)=' .env.local .env.production.local | ssh user@<the VM's static IP> 'f=~/.aircheck/console.env; [ -z "$(tail -c1 "$f")" ] || echo >> "$f"; cat >> "$f"'
   ```

   Then on the VM:

   ```sh
   cut -d= -f1 ~/.aircheck/console.env | sort | uniq -d   # prints a name only if it is in the file twice; expect nothing
   cd ~/air-check && git pull
   dc up -d --build
   dc ps                                                  # console should say "healthy"
   ```

   The route answers 503 until the webhook secret exists (step 3 below). That is the safe state.

4. **The ingest worker last.** Why: it reads what the console stores, and it needs the Token Factory key. On the Mac:

   ```sh
   ssh user@<the VM's static IP> 'f=~/.aircheck/ingest.env; [ -z "$(tail -c1 "$f")" ] || echo >> "$f"; cat >> "$f"' < ~/.aircheck-local/ingest-radar.env
   pnpm --filter @aircheck/ingest build
   wc -c apps/ingest/dist/main.js                         # note the size
   ssh user@<the VM's static IP> 'cp ~/aircheck-ingest/dist/main.js ~/aircheck-ingest/dist/main.js.pre-radar'
   ssh user@<the VM's static IP> 'cat > ~/aircheck-ingest/dist/main.js' < apps/ingest/dist/main.js
   ```

   Then on the VM:

   ```sh
   wc -c ~/aircheck-ingest/dist/main.js                   # must match the Mac's size
   sudo systemctl restart aircheck-ingest
   journalctl -u aircheck-ingest -n 20                    # expect step=start ok=true and no config error
   ```

**Rolling back:** undo in the reverse order, and **roll Convex back last**. The ingest worker (`cp main.js.pre-radar main.js`, then restart), then the console (see "Rolling back"), then the bridge, and only then Convex (check out the old commit on the Mac and run `npx convex deploy -y`). Why: an old console works against the new Convex, but the new console does not work against the old one.

### 3. Register the webhook

Why: this tells AgentMail where to send new mail, and gives us the secret that proves a delivery came from AgentMail. On the Mac, from `apps/console`:

```sh
umask 077; tmp=$(mktemp)
curl -s -X POST https://api.agentmail.to/v0/inboxes/rhythmlab%40agentmail.to/webhooks \
  -H "Authorization: Bearer $(grep '^AGENTMAIL_API_KEY=' .env.local | cut -d= -f2-)" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://aircheck.rhythmlabradio.com/api/agentmail/inbound","event_types":["message.received"]}' > "$tmp"
jq -r .webhook_id "$tmp"                                  # the only thing printed; write it below
f=.env.production.local; [ -z "$(tail -c1 "$f" 2>/dev/null)" ] || echo >> "$f"
jq -r '"AGENTMAIL_WEBHOOK_SECRET=" + .secret' "$tmp" >> "$f"
rm "$tmp"
grep -h '^AGENTMAIL_WEBHOOK_SECRET=' .env.production.local | ssh user@<the VM's static IP> 'f=~/.aircheck/console.env; [ -z "$(tail -c1 "$f")" ] || echo >> "$f"; cat >> "$f"'
```

Then on the VM: `dc up -d --force-recreate console`. Why `--force-recreate`: the container reads `console.env` only when it is created, so a plain restart would not see the new value.

Webhook id: _(write it here after registering)_. To rotate the secret: delete the webhook in AgentMail, register again as above, remove the old `AGENTMAIL_WEBHOOK_SECRET` line from both files, pipe the new one, and recreate the console.

### 4. Set the sender list (before the Gmail filter)

1. **Add the forwarding address in Gmail.** Settings, "Forwarding and POP/IMAP", "Add a forwarding address", `rhythmlab@agentmail.to`. If the option is greyed out, the Radio Milwaukee Workspace admin has turned off automatic forwarding; ask them. Gmail sends a confirmation email to the inbox: open it in AgentMail's own web console (not Air Check) and click the confirmation link or copy the code. In Air Check it shows under Not added as "Sender not on the list", which is expected.
2. **Find Bandcamp's sender address.** In Gmail, open a Bandcamp new-release email you already have, choose "Show original", and copy the address in its `From:` line. Why: auto-forwarded mail keeps Bandcamp's own From address, so that exact address must be on the list.
3. **Set the list on the VM**, then recreate the console:

   ```sh
   nano ~/.aircheck/console.env
   # add or edit this line:
   # RADAR_SENDERS=tarik@radiomilwaukee.org,<Bandcamp's address from step 2>
   dc up -d --force-recreate console
   ```

4. **Only now, turn on the Gmail filter** that forwards Bandcamp's new-release email to `rhythmlab@agentmail.to`. Co-signs are forwarded by hand.

### 5. Live checks (UNVERIFIED until Task 7)

Each of these was built from documentation or a guess, not a live test. Check each once and record the result in `docs/SPIKES.md`.

- **Verified live on 2026-10-29: the payload names the inbox, and the sender verdict.** Deliveries carry `inbox_id: rhythmlab@agentmail.to`. AgentMail's message has **no** `Authentication-Results` header (its `headers` hold only ARC-*, Delivered-To, Reply-To and X-* lines). Instead every message carries `authentication_results` (`spf`, `dkim`, `dmarc`, and `spf_domain`, `dkim_domain`, `dmarc_domain`) and `labels`. Seen: Bandcamp's auto-forwarded mail has `dkim: none` but `dmarc: pass` for `bandcamp.com`; mail from `tarik@radiomilwaukee.org` passes all three for `radiomilwaukee.org`. This is why the header check was replaced (ruling R12). If AgentMail's verdict ever goes missing, the console answers 503 and stores nothing for a listed sender, so AgentMail retries; `dc logs console` shows `radar step=get-message ok=false` and the catch-up script shows `failed (AgentMail)`. A verdict that is present but failing is stored as "AgentMail could not confirm the sender".
- **Live spoof check.** Send a forged `From: noreply@bandcamp.com` from a non-Bandcamp server to `rhythmlab@agentmail.to`. Expect AgentMail to drop it, or Not added to show "AgentMail could not confirm the sender". It must never appear on the Bandcamp tab.
- **Token Factory accepts the reader's settings.** The reader sends `chat_template_kwargs` (thinking off). Expect, in `journalctl -u aircheck-ingest`, co-signs saved with no 400 error; in the Token Factory usage page, answers with content and about zero reasoning tokens. On a 400 the reader retries once without it.
- **Bandcamp answers our user-agent.** The first Bandcamp email's player should become ready within two passes. If every page fails, the ingest log names the code.
- **The real Bandcamp email and page.** The email parser and the page reader (cover art from `og:image`, tags, about) were written against made-up samples. Compare one real email and one real page with what Air Check shows.
- **Google Workspace (co-signs): checked 2026-10-29.** Mail sent from `tarik@radiomilwaukee.org` reaches AgentMail with DMARC passing for `radiomilwaukee.org`, so hand-forwarded co-signs are kept. If that ever changes (Not added shows "AgentMail could not confirm the sender" for Tarik's own forwards), check the DKIM key in the Google Admin console: Apps, Google Workspace, Gmail, "Authenticate email".

### 6. Catch up mail the old sender check refused (one-off, ruling R12)

Why: until the R12 fix, the console refused every email (it looked for a header AgentMail does not send), and the webhook was paused while the fix was made. The mail is still in AgentMail. This script lists it and runs each message through the same code as the webhook. An email stored as "ignored" before is stored again if it is now kept; one already kept is left alone, so running it twice is safe.

Deploy order for the fix: Convex first (`radar.received` learns to replace an ignored row with a kept one), then the console, then resume the webhook, then this script.

On the Mac, from the repo root. `RADAR_SENDERS` must be the VM's value; `CONVEX_URL` is production (the dev URL in `.env.local` is never used). The script reads `AGENTMAIL_API_KEY` from `apps/console/.env.local` and `INBOX_TOKEN` from `apps/console/.env.production.local`, and prints codes and counts only: never a subject, sender, body or key.

```sh
export RADAR_SENDERS="$(ssh user@<the VM's static IP> "grep '^RADAR_SENDERS=' ~/.aircheck/console.env | cut -d= -f2-")"
export CONVEX_URL=https://clever-deer-759.convex.cloud
pnpm --filter console exec tsx scripts/radar-backfill.ts --since 2026-10-27 --dry-run   # look first: one line per message
pnpm --filter console exec tsx scripts/radar-backfill.ts --since 2026-10-27             # then store
unset RADAR_SENDERS CONVEX_URL
```

Each line is `#n kept`, `#n ignored <reason>`, or `#n failed (AgentMail)` / `#n failed (Convex <code>)` (for example `UNAUTHORIZED`: the `INBOX_TOKEN` does not match Convex); the last line is the counts. Exit code 1 means something failed: run it again. Kept emails then appear in the radar within a minute (the ingest worker reads them).

### 7. Repair Bandcamp releases stored by the old parser (one-off, listening-queue brief B)

Why: the first Bandcamp parser was written against made-up mail. On real mail it stored, for example, the artist as `Roots Records, check it out at:`. `--reparse` re-reads each kept Bandcamp email since the date with the fixed parser and asks `radar.reparse` (INBOX_TOKEN) to patch artist, title and label on the release that email made, never a field you edited. If the corrected name matches another release, both are left alone and the line says `collision`. A Bandcamp release whose player is ready but has no release date is also queued again, so the ingest worker re-reads its page for the date (3 per pass); if that read fails, the working player stays.

Deploy order, in full: **Convex → ingest worker → console → `--reparse --dry-run` → `--reparse`.** Convex goes first because the new ingest worker sends `releasedOn` **and** `pageArtist` to `radar.embedResult`; an older Convex refuses the unknown field, and the page stays queued and is fetched again every pass. Convex also adds `radar.reparse`. A release whose date you set or cleared is never re-queued. Same environment as section 6; the dry run also needs `CONVEX_URL` and `INBOX_TOKEN`, because it asks Convex what it would change (and writes nothing).

```sh
export RADAR_SENDERS="$(ssh user@<the VM's static IP> "grep '^RADAR_SENDERS=' ~/.aircheck/console.env | cut -d= -f2-")"
export CONVEX_URL=https://clever-deer-759.convex.cloud
pnpm --filter console exec tsx scripts/radar-backfill.ts --reparse --since 2026-10-27 --dry-run   # look first
pnpm --filter console exec tsx scripts/radar-backfill.ts --reparse --since 2026-10-27             # then repair
unset RADAR_SENDERS CONVEX_URL
```

Each line is `#n repaired`, `#n unchanged`, `#n collision` or `#n not-found`, with ` requeued` when the page was queued again; `#n skipped (...)` for mail that is not a kept Bandcamp email or does not match the template; or a `failed` line as in section 6. It never prints a title or sender. Running it twice is safe: the second run says `unchanged`.

### 8. Roundup emails (decision 024, branch `feat/radar-roundup`)

A forwarded roundup (several releases in one email) now makes one release record each, up to 12. It touches Convex and the ingest worker only: the extraction skill is not an agent skill; its text is built into the ingest worker (`packages/core/src/radar/extractionSkill.ts`, regenerated by `pnpm sync:skills`), so there is no `install-skills.sh` step. Deploy after the PR is merged, in this order:

1. **Convex** (Mac, `apps/console`): `npx convex deploy -y`. The new Convex accepts both the old ingest worker's outcome and the new one (the new one adds an optional `more` list), so it goes first.
2. **The ingest worker**: build and copy `dist/main.js` as in "2. Deploy, in this order", step 4, above (keep a `main.js.pre-roundup` copy), then `sudo systemctl restart aircheck-ingest` and `journalctl -u aircheck-ingest -n 20` (expect `step=start ok=true`).
3. **Forward the Oct 30 co-sign roundup again.** It was recorded "not a release", which deletes the stored body, so "Try again" cannot read it. A fresh forward is a new email. Check: the Co-sign tab shows one record per release in the subject line, and "Not added" shows nothing new for it. `journalctl -u aircheck-ingest` shows one `step=radar-read ok=true state=saved` line for it.

Rolling back: the ingest worker first (`cp main.js.pre-roundup main.js`, restart), then Convex. An old Convex refuses the new worker's `more` key, so the reverse order would leave roundups failing until both are back.

## Certificates and renewal dates

The bridge uses a private certificate authority (CA, the signer that vouches for a certificate) made for this project, because the bridge has no public hostname.

| What | File | Made by | Expires | Renew |
|---|---|---|---|---|
| Private CA ("Air Check private CA", EC P-256) | `~/.aircheck/ca/ca.crt` and `ca.key` | `deploy/bridge/make-ca.sh` | 2031-10-26 | Needs a re-onboard of the sandbox (`airc` only through `deploy/hermes/reonboard-without-tavily.sh`) |
| Bridge leaf certificate (IP `10.104.0.41`) | `~/.aircheck/bridge/tls.crt` and `tls.key` | `deploy/bridge/make-leaf.sh 10.104.0.41` | **2027-10-27** | Re-run `make-leaf.sh 10.104.0.41`, then `sudo systemctl restart aircheck-bridge`. No sandbox rebuild, because the CA is the same |

**Tarik: set a calendar reminder for early October 2027 to renew the leaf certificate.** If it lapses, Hermes cannot reach the bridge, and the watchdog will message you that the bridge is down.

`ca.key` never leaves the VM. NemoClaw takes `ca.crt` on its own: it rejects a merged system bundle and adds the CA to its own list.

## Point the bridge at prod (done 2026-10-27)

The bridge was switched to prod on 2026-10-27, and the relay followed the same day (see "The relay"). The steps are kept here so the switch can be redone. Do not test an end-to-end path until the bridge and the relay point at the same deployment (see the learning log).

- [x] Make a new random value for production, for example `openssl rand -hex 24`. Do not reuse the dev token.
- [x] From the Mac, with `CONVEX_DEPLOY_KEY` set as in "Convex production commands": `npx convex env set AGENT_SUBMIT_TOKEN <the new value>` in `apps/console`.
- [x] `npx convex env set AIRCHECK_PRIVATE_TERMS '<comma-separated list>'` on prod, with the private words that must never appear in a public description. Or leave it empty on purpose: empty means the private-term check in public descriptions does nothing.
- [x] Deploy prod with the same section's `npx convex deploy -y`, so the `/agent/packages` route exists on `clever-deer-759`.
- [x] On the VM, edit `~/.aircheck/bridge.env`: put the same token value in, and set the Convex site address to `https://clever-deer-759.convex.site`. (The variable names are in `deploy/bridge/bridge.env.example`.)
- [x] `sudo systemctl restart aircheck-bridge`.
- [x] Check with `journalctl -u aircheck-bridge -n 20` and `~/.aircheck/watchdog.sh --dry-run`.
- [x] Unset `CONVEX_DEPLOY_KEY` on the Mac when done.

## Evidence the agent side works (checked 2026-10-27)

- **Final reboot test** (05:14:25Z): the console answered 200, the Hermes unit succeeded 55 seconds after boot, Hermes health was 200, the bridge was ok, both MCP servers were `ready` with `match`, the private address was unchanged, the shutdown log showed "Stopped sandbox airc", and the watchdog sent no alert. The first reboot exposed the `Error` problem and the second exposed the `recover` timing. Both are fixed.
- **End to end:** Hermes run `run_71f865226db3481ab20181e0e475a685` called `mcp__crate__musicbrainz_search_artist` and then `mcp__aircheck__package_submit`. It finished in 18 seconds. Dev Convex got `pkg-10-9-26` in status `preparing_audio` with 31 tracks. See the V4 row in `docs/SPIKES.md`.

## Rolling back

This needs the git clone from the section above (the `mv` then `git clone` steps). The archive copy has no history, so there is nothing to check out until the clone is done. The clone keeps the same Compose project name, so rolling back keeps the certificate.

```sh
cd ~/air-check
git log --oneline -10            # find the last good commit
git checkout <that commit>
docker compose --env-file ${HOME}/.aircheck/console.env -f deploy/compose.yaml up -d --build
```

When fixed, `git checkout main && git pull` to get back on the latest. A bad Convex change is rolled back by checking out the old commit on the Mac and running `npx convex deploy -y` again.

## After the judging period (Dec 15)

The demo stays open to judges until Dec 15. After that:

1. Stop the VM from the Nebius console (or with the CLI). Unverified: stopping the VM should end the compute charge, and a reserved static IP should keep billing. Check the Nebius billing page, and release the IP too if the site is going away for good.
2. To take the site down but keep the data, nothing else is needed. To remove it completely, delete the DNS records and the Clerk and Convex production projects.
3. The hourly re-seed cron lives in Convex. If the Convex project stays up, remove its entry in `apps/console/convex/crons.ts` and run `npx convex deploy -y` to stop it.

## Evidence it works (checked 2026-10-26)

- `http://` redirects to `https://` (308, a permanent redirect). `https://.../sign-in` returns 200 with the HSTS header (tells browsers to always use HTTPS).
- `/demo` redirects (302, a temporary redirect) to a relative path, not to an internal address.
- From outside, only ports 22, 80 and 443 are open. 3000, 8080, 8642, 18789 and 111 are closed.
- The demo door's rate limit returns 429 after 10 tries, even with a forged `X-Forwarded-For` header, because the front door overwrites `X-Real-IP`.
- In a real browser: `/demo` lands on `/today` as role demo, no development badge, approving shows "Approved · sample, not published" with a notice and a Trust row.
- iPhone 13 viewport (375 px): no sideways scroll, and Approve, Edit and Skip are 48 px tall.
- The demo workspace was re-seeded afterwards. The Let's Encrypt certificate renews itself; the current one runs to 2027-01-25.

## Known gaps

- Google sign-in is not on in production (needs a Google OAuth client).
- CI does not run the browser tests (decision 009), so run `pnpm --filter console e2e` before merging.
