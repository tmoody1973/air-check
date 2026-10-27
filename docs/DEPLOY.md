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

Copy `deploy/console.env.example` to `~/.aircheck/console.env` on the VM, fill in the values, then `chmod 600` it. It holds seven names: the Convex URL, the Clerk publishable and secret keys, the app URL, the demo user id, and two telemetry-off switches. It has no Convex deploy key.

The `NEXT_PUBLIC_*` values are baked into the image when it is built, so changing one needs a rebuild, not just a restart.

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

Both containers have `restart: unless-stopped`, and `docker` and `containerd` (the engine underneath Docker) are enabled at boot, so the site should come back by itself. A full VM reboot has not yet been tested with the stack running; that test is planned as the first task of Plan 4. Until then, after any reboot:

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
2. Make the folder for secrets: `mkdir -p ~/.aircheck && chmod 700 ~/.aircheck`, then create `console.env` as described above.
3. Point the `aircheck` A record at the new VM's IP, and wait until it resolves. It must resolve before the first `up`, or the certificate request fails.
4. `git clone https://github.com/tmoody1973/air-check ~/air-check`, then run the start command.

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

- **Hermes (the AI agent that will draft show material) is currently down.** After the VM was stopped and started, the NemoClaw sandbox (the locked-down box Hermes runs in) stayed in an Error state, and `start` and `recover` cannot clear it (details in `docs/FRICTION_LOG.md`). The expected fix is a `rebuild` at the start of Plan 4. It needs Tarik's OK first, and Telegram (the chat app used for approval links) and Tavily (a web-search service) setup may need to be redone. The `~/.local` permission problem that blocked `start` was already fixed on the VM. The console does not depend on Hermes yet.
- Google sign-in is not on in production (needs a Google OAuth client).
- CI does not run the browser tests (decision 009), so run `pnpm --filter console e2e` before merging.
