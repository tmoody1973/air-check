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
mkdir -p ~/.aircheck/mixcloud ~/aircheck-audio/prepared
sudo chown 1000:1001 ~/.aircheck/mixcloud
sudo chmod 2770 ~/.aircheck/mixcloud   # owner 1000, group 1001; the 2 (setgid) makes new files group 1001
```

The console writes `token.json` with mode 640: the console can rewrite it and the publisher (group 1001) can read it, and no one else can. Check after connecting with `ls -ln ~/.aircheck/mixcloud` (expect `-rw-r----- 1000 1001`). "Disconnect" in Settings deletes the file. The container only mounts this folder read-write, plus `~/aircheck-audio/prepared` read-only for the player; the rest of the container stays read-only.

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
2. Make the folder for secrets: `mkdir -p ~/.aircheck && chmod 700 ~/.aircheck`, then create `console.env` as described above, and the Mixcloud token folder as in "The Mixcloud token folder".
3. Point the `aircheck` A record at the new VM's IP, and wait until it resolves. It must resolve before the first `up`, or the certificate request fails.
4. `git clone https://github.com/tmoody1973/air-check ~/air-check`, then run the start command.
5. The agent side (Hermes, bridge, watchdog) has its own steps, each described in the sections below:
   - Linger on: `sudo loginctl enable-linger user`. The VM user must be uid 1001 (the units hard-code `user@1001` and `/run/user/1001`).
   - The bridge bundle, before its unit: `mkdir -p ~/aircheck-bridge`, then steps 1–4 of "Updating the bridge" below.
   - The relay bundle and settings: `mkdir -p ~/aircheck-relay/dist`, then steps 1–3 of "Updating the relay" below, and `~/.aircheck/relay.env` (mode 600) from `deploy/relay/relay.env.example`.
   - The four units: `aircheck-hermes.service`, `aircheck-bridge.service`, `aircheck-relay.service` and `aircheck-watchdog.service` plus its `.timer` (copies in `deploy/`).
   - The private CA and leaf certificate: `deploy/bridge/make-ca.sh`, then `make-leaf.sh <private ip>`.
   - `crate-cli` cloned to `~/crate-cli` at commit `37f4ec2`, built with `npm ci && npm run build`.
   - `~/.aircheck/bridge.env` (mode 600) from `deploy/bridge/bridge.env.example`.
   - The ufw rule that lets only the sandbox network reach port 8443.
   - Both `nemohermes airc mcp add` commands (crate and aircheck).

## The Hermes sandbox

Hermes is the AI agent that drafts show material. It runs inside a NemoClaw sandbox (a locked-down container) called `airc`. A program called the OpenShell gateway supervises the sandbox. Everything in this section runs on the VM.

**What keeps it alive across a reboot**

- **Linger is on.** The gateway is a systemd *user* service (systemd is Ubuntu's service manager), `nemoclaw-openshell-gateway.service`. Ubuntu only runs user services while someone is logged in over SSH, unless "linger" is on. It was off, so after a VM stop and start nothing launched the gateway and the sandbox went to phase `Error`. The fix, already applied: `sudo loginctl enable-linger user`. Do not undo it (`disable-linger` would bring the outage back).
- **A boot unit.** `/etc/systemd/system/aircheck-hermes.service` (a copy lives in the repo at `deploy/hermes/aircheck-hermes.service`) runs `nemohermes airc start` at boot. Then it retries `nemohermes airc recover` every 15 seconds for up to 5 minutes. Both are needed: `start` does not bring back the forwarded port 8642 that the console talks to, and `recover` does, but only once the sandbox is up.
- **A clean shutdown.** When the VM stops, the unit runs `openshell sandbox stop airc` before Docker and the gateway stop. It is an `ExecStopPost` step, so it also runs when a shutdown interrupts the boot retries or the start times out (systemd skips a plain `ExecStop` in both cases). Without it, Docker kills the container first, the gateway records an unexpected exit, and the sandbox lands in `Error` instead of `Stopped`.

Check it:

```sh
nemohermes airc status                      # Phase should be Ready
curl -s http://127.0.0.1:8642/health        # expect a 200 response
systemctl status aircheck-hermes            # expect active (exited)
```

`active (exited)` does not mean Hermes is healthy: the unit stays active even if `recover` gave up after 5 minutes (that is deliberate, so a failed unit cannot skip the clean shutdown). The real check is `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8642/health`.

**If the sandbox is in `Error` anyway**

`Error` is a dead end. `openshell sandbox stop` needs `Ready`, `start` needs `Stopped`, `recover` only reports, and `rebuild` fails its preflight check ("Sandbox 'airc' is unreachable"). Only destroying the sandbox and onboarding it again clears it. The script is `~/.aircheck/reonboard.sh`. It loads `~/.airc/secrets.env`, uses the same settings as the original install, and adds `NEMOCLAW_CORPORATE_CA_BUNDLE=~/.aircheck/ca/ca.crt` (see Certificates below). It takes about 45 seconds.

1. Destroy needs the old container running, so start it first: `docker ps -a` to find its name, then `docker start <container>`.
2. Run `~/.aircheck/reonboard.sh`.
3. Register the two bridge tools again with the `mcp add` commands under "Registering the bridge with Hermes". Unverified: whether onboarding keeps the earlier registration. Re-running is safe either way.

**Hermes loses its memory when this runs.** A copy of the Hermes home from before the outage is at `~/.aircheck/hermes-backup-2026-10-27/` on the VM. It holds keys tied to that machine, so never copy it off the VM.

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

A timer checks every five minutes that Hermes, the bridge and the relay are up, and texts Tarik on Telegram when one is not.

- `/etc/systemd/system/aircheck-watchdog.timer` runs `~/.aircheck/watchdog.sh` (repo copy: `deploy/hermes/watchdog.sh`) 3 minutes after boot and then every 5 minutes.
- It probes Hermes at `http://127.0.0.1:8642/health`, the demo Hermes at `http://127.0.0.1:8643/health` and the bridge at `https://10.104.0.41:8443/healthz`. A fourth probe, named `Relay`, runs `systemctl is-active --quiet aircheck-relay`.
- The relay probe was added with Plan 4b. The previous copy of the script is kept on the VM as `~/.aircheck/watchdog.sh.pre-4b`.
- When something goes down it sends one message: "Air Check: <name> is down since HH:MM. Console unaffected." When everything is back it sends one more. Otherwise it says nothing.
- It remembers what it last saw in `~/.aircheck/watchdog.state`. Messages that could not be sent wait in `~/.aircheck/watchdog.pending` and go out with the next successful send.
- To test without sending a message: `~/.aircheck/watchdog.sh --dry-run` prints what it would send.

## The bridge

The bridge is a small program that sits between Hermes and two things Hermes may not touch directly: the Crate research tools and the app's "submit a package" route. Hermes can only speak to remote tools over HTTPS with one bearer token (a secret string sent with each request), so the bridge provides exactly that. Decision 006 has the reasoning.

**Why it is a host process, not a container.** The VM's firewall (ufw) protects ports on the host. Ports that Docker publishes skip ufw. Running the bridge under systemd on the host means one firewall rule decides who can reach it.

- **Code:** `apps/bridge` in this repo, running from `~/aircheck-bridge` on the VM. The research tools come from `crate-cli`, cloned at `~/crate-cli` (commit `37f4ec2`, built with `npm ci && npm run build`). It has no LICENSE, so we call it and never copy it into this repo.
- **Service:** `/etc/systemd/system/aircheck-bridge.service` (repo copy: `deploy/bridge/aircheck-bridge.service`). Logs: `journalctl -u aircheck-bridge`. It logs one line per call, such as `tool=<name> ok=<bool> ms=<n>`, and never the arguments.
- **Settings:** `~/.aircheck/bridge.env` (mode 600). The variable names are in `deploy/bridge/bridge.env.example`.
- **Address:** it listens only on the VM's private address `10.104.0.41`, port 8443. The endpoints are `/crate/mcp` (16 tools), `/aircheck/mcp` (one tool, `package_submit`) and `/healthz`.
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

Re-run both `mcp add` commands after any re-onboard (see the Hermes section for the unverified part).

### Updating the bridge

1. On the Mac: `pnpm --filter @aircheck/bridge build && pnpm --filter @aircheck/bridge deploy --prod --legacy <dir>` (a self-contained bundle in `<dir>`).
2. Pack it: `COPYFILE_DISABLE=1 tar -C <dir> --exclude ./test --exclude ./src -czf bridge.tgz .` (the variable stops macOS adding hidden metadata files).
3. Copy it with ssh and `cat`: `ssh user@<the VM's static IP> 'cat > /tmp/bridge.tgz' < bridge.tgz`
4. On the VM: `tar -xzf /tmp/bridge.tgz -C ~/aircheck-bridge && rm /tmp/bridge.tgz`. Tar warnings about `LIBARCHIVE.xattr` headers are harmless.
5. `sudo systemctl restart aircheck-bridge`, then check `curl -s --cacert ~/.aircheck/ca/ca.crt https://10.104.0.41:8443/healthz` (expect `ok`), `journalctl -u aircheck-bridge -n 20`, and the watchdog's `--dry-run`.

`scp` and `rsync` mangled the paths on this setup (see `docs/FRICTION_LOG.md`); use ssh and `cat` as above.

### Where the agent's submit goes

Hermes calls `package_submit`, and the bridge posts to the app's `POST /agent/packages` route on Convex with a token called `AGENT_SUBMIT_TOKEN` (decision 011). A person still has to approve the package in the console. The bridge pointed at the **dev** Convex deployment (`optimistic-lobster-654`) until 2026-10-27, when it moved to prod. The dev checks: Live checks there gave 401 for a wrong token, 201 `{"packageId":"pkg-10-2-26","status":"preparing_audio"}` for a good one, and 409 `{"error":"ALREADY_EXISTS"}` for a repeat.

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

## Certificates and renewal dates

The bridge uses a private certificate authority (CA, the signer that vouches for a certificate) made for this project, because the bridge has no public hostname.

| What | File | Made by | Expires | Renew |
|---|---|---|---|---|
| Private CA ("Air Check private CA", EC P-256) | `~/.aircheck/ca/ca.crt` and `ca.key` | `deploy/bridge/make-ca.sh` | 2031-10-26 | Needs a re-onboard of the sandbox |
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
