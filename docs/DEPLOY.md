# Deploying the Air Check console

The console (the website) runs on one Nebius virtual machine (VM) called `airc-vm`, in Docker. The live site is https://aircheck.rhythmlabradio.com. Sign-in is Clerk, the database is Convex. Both are hosted services, so the VM only runs the website and a front door.

This page has no addresses or keys on purpose, because the repo is public. The VM's static IP is in the Nebius console. Secrets live only in `~/.aircheck/console.env` on the VM (mode 600, meaning only its owner can read it) and in `apps/console/.env.production.local` on Tarik's Mac.

## The pieces

- **Docker Compose** (a tool that starts several containers from one file): `deploy/compose.yaml` starts two containers.
- **`console`**: the Next.js website, built by `deploy/Dockerfile`. It has no published port, so nothing outside can reach it directly.
- **`caddy`**: a web server that takes ports 80 and 443, gets a free HTTPS certificate from Let's Encrypt by itself, and passes traffic to `console`. Config is `deploy/Caddyfile`. It writes no access log on purpose, because a sign-in link can carry a one-time token.
- **Convex production** (deployment `clever-deer-759`): the database and the hourly job in `apps/console/convex/crons.ts` that re-seeds the demo workspace.

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
2. Sign-in method: email code only for now. Google needs your own Google OAuth client, so it comes later.
3. Turn on the Convex integration (this creates the JWT template, the token Convex uses to know who is signed in). Its issuer domain is `https://clerk.aircheck.rhythmlabradio.com`.
4. Add the session claims the console reads (the role and email fields), same as in the development instance.
5. Create the demo user: role `demo`, an email that is not `@radiomilwaukee.org`.
6. Copy the `pk_live_...` publishable key, the `sk_live_...` secret key and the demo user's id into the env files below.

### Convex production commands

Run from `apps/console` on the Mac. `CONVEX_DEPLOY_KEY` (a `prod:...` key) comes from `apps/console/.env.production.local`, which is gitignored. It must never be copied to the VM.

```sh
cd apps/console
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.aircheck.rhythmlabradio.com
npx convex deploy -y            # pushes functions, schema and the hourly cron
npx convex run seed:seedDemo    # loads the sample workspace
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

Look at the state and the logs:

```sh
docker compose -f deploy/compose.yaml ps          # console should say "healthy"
docker compose -f deploy/compose.yaml logs -f console
docker compose -f deploy/compose.yaml logs -f caddy
```

Restart without rebuilding:

```sh
docker compose --env-file ${HOME}/.aircheck/console.env -f deploy/compose.yaml restart
```

### Getting new code onto the VM

The first copy was sent from the Mac with `git archive` (a snapshot of the files with no history). Once the `deploy/console` branch is merged, use git instead:

```sh
git clone https://github.com/tmoody1973/air-check ~/air-check   # first time only, replaces the copied folder
cd ~/air-check && git pull                                      # every update after that
```

Then run the start/update command above. If Convex functions changed, also run `npx convex deploy -y` from the Mac.

## Rolling back

```sh
cd ~/air-check
git log --oneline -10            # find the last good commit
git checkout <that commit>
docker compose --env-file ${HOME}/.aircheck/console.env -f deploy/compose.yaml up -d --build
```

When fixed, `git checkout main && git pull` to get back on the latest. A bad Convex change is rolled back by checking out the old commit on the Mac and running `npx convex deploy -y` again.

## After the judging period (Dec 15)

The demo stays open to judges until Dec 15. After that:

1. Stop the VM from the Nebius console (or with the CLI). Stopping ends the compute charge. A reserved static IP may still be billed, so release it too if the site is going away for good.
2. To take the site down but keep the data, nothing else is needed. To remove it completely, delete the DNS records and the Clerk and Convex production projects.
3. The hourly re-seed cron lives in Convex. If the Convex project stays up, remove its entry in `apps/console/convex/crons.ts` and run `npx convex deploy -y` to stop it.

## Evidence it works (checked 2026-10-26)

- `http://` redirects to `https://` (308). `https://.../sign-in` returns 200 with the HSTS header (tells browsers to always use HTTPS).
- `/demo` redirects (302) to a relative path, not to an internal address.
- From outside, only ports 22, 80 and 443 are open. 3000, 8080, 8642, 18789 and 111 are closed.
- The demo door's rate limit returns 429 after 10 tries, even with a forged `X-Forwarded-For` header, because the front door overwrites `X-Real-IP`.
- In a real browser: `/demo` lands on `/today` as role demo, no development badge, approving shows "Approved · sample, not published" with a notice and a Trust row.
- iPhone 13 viewport (375 px): no sideways scroll, and Approve, Edit and Skip are 48 px tall.
- The demo workspace was re-seeded afterwards. The Let's Encrypt certificate renews itself; the current one runs to 2027-01-25.

## Known gaps

- **Hermes is currently down.** After the VM was stopped and started, the NemoClaw sandbox stayed in an Error state, and `start` and `recover` cannot clear it (details in `docs/FRICTION_LOG.md`). The expected fix is a `rebuild` at the start of Plan 4. It needs Tarik's OK first, and Telegram and Tavily setup may need to be redone. The `~/.local` permission problem that blocked `start` was already fixed on the VM. The console does not depend on Hermes yet.
- Google sign-in is not on in production (needs a Google OAuth client).
- CI does not run the browser tests (decision 009), so run `pnpm --filter console e2e` before merging.
