# Air Check

**A private AI producer for Rhythm Lab Radio. It drafts. I approve. It never holds the keys.**

I've hosted Rhythm Lab Radio on Radio Milwaukee for more than twenty years. Every week the show gets made, and every week a second job waits: join two hours of audio, write a Mixcloud title, tags and description, format the tracklist, research every track, and sort a flood of label emails. That second job left about 35 of my 2026 shows offline, and after Congress cut federal funding for public media in 2025, hiring a producer wasn't an option. Air Check does the second job, and only I can publish.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI track.

- **Demo video (2:53):** https://youtu.be/OIWQ_VE_Frk
- **Try it (no account needed):** https://aircheck.rhythmlabradio.com/demo — a sample workspace with its own sandboxed agent; it cannot publish. Open until Dec 15, 2026.

## What it does

- **Mixcloud packages.** When a show's two hour-long files land in Box, the agent drafts the package: a title in the house style, five tags, a description in my voice, and the tracklist. Code joins the audio and builds the tracklist, so no song is dropped. I can watch the run live and take over.
- **Approval stays human.** My phone gets a Telegram link, never an approve button. Approving happens only in the signed-in console, and a separate publisher, not the agent, uploads the show.
- **Sourced show notes.** Paste a playlist and Air Check runs every track's web searches at once, in code, then the agent writes notes shaped like the ones I used to write by hand: album and label, the story, samples and connections, video. Every fact links its source; anything single-sourced or unsourced is marked [verify]. On a live run, 12 searches came back in 24 seconds and six tracks were written in under four minutes.
- **Deep dives.** Any artist, label or release as a short Wikipedia-style article: a fact box, sections in prose, numbered references, and how often it has been on my show (counted in code).
- **Pre-air verify.** Checks my own notes against sources before I go on air.
- **Release radar.** Bandcamp and label emails become release records I can play, consider or pass on, including roundup emails that list a dozen releases. Links and addresses are stripped before any model reads an email, and an embargo holds the approve button until its date. Players and covers attach from the Bandcamp page I have open, with a "Send to Air Check" bookmarklet.
- **Trust.** Every network call the agent's sandbox made or was refused, shown to me.
- **Skills and memory.** The skills the agent works from (readable files it can't rewrite), and what Air Check has learned from my own fixes, passes and edits.

## How it stays safe

1. The agent drafts; only a signed-in person approves a publish. There is no code path from the model to the Mixcloud upload, and a test fails if one appears.
2. The agent holds no Box, Drive, Dropbox, Mixcloud, search or Apple credentials. Workers outside the sandbox hold them.
3. Email is data, never instructions. Promos are read by one Nemotron call with no tools, and code checks every field against the email.
4. Show notes and deep dives are private. Public Mixcloud descriptions allow no unverified claims and no private details.
5. The sandbox reaches only approved hosts, and every attempt is logged on the Trust page.

## Where it runs

- **Model:** NVIDIA Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) on **Nebius Token Factory**. About 43 million tokens over the last month, most of them cached, for $4.70.
- **Agent:** **Hermes Agent** in an **NVIDIA OpenShell** sandbox, installed with **NVIDIA NemoClaw**, restricted policy tier.
- **Compute:** one **Nebius AI Cloud** VM (CPU only; inference is on Token Factory) running everything under Docker Compose.
- **Research:** **Tavily** search (advanced depth, page text for fact checks), Apple Music, and my Crate service (MusicBrainz, Wikipedia, Bandcamp search, iTunes), all behind a research bridge outside the sandbox.
- **App:** Next.js, Tailwind, Convex, Clerk. Email arrives through AgentMail.

## Repository

| Path | What it is |
|---|---|
| `apps/console` | The console (Next.js) and its Convex backend: approval, research, radar, trust |
| `apps/bridge` | The research bridge: MCP tools for the agent, Tavily and Apple Music calls, parallel first searches |
| `apps/relay` | Starts agent runs and streams their steps to the console |
| `apps/ingest` | Reads Box, Google Drive and Dropbox; reads release emails; Bandcamp player ids |
| `apps/media` | Joins a show's two hours into one MP3 (ffmpeg) |
| `apps/publisher` | The only service with the Mixcloud login; uploads approved packages |
| `packages/core` | The deterministic rules: tracklist parsing, closing tracks, title, tag and description checks, the approval gate, research checks |
| `skills/` | The station skills the agent works from |
| `deploy/` | Docker Compose, systemd units and the Hermes setup scripts |

## Develop

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test    # about 2,600 tests; CI runs them on every pull request
```

## Docs

- `docs/PRD.md`, `docs/ARCHITECTURE.md`: requirements and architecture
- `docs/decisions/`: the decision log, one plain-English record per real choice
- `docs/DEPLOY.md`: how each piece is deployed, checked and rolled back
- `docs/FRICTION_LOG.md`: 35 dated entries on what got in the way, with workarounds
- `docs/SPIKES.md`, `docs/LEARNING-LOG.md`: experiments and what we learned
- `skills/`: the station skills

## What existed before the hackathon

Air Check is new work, started Oct 26, 2026 from planning docs written Oct 19. It calls my existing Crate research service over MCP and borrows patterns, not code, from Crate Web, TarikOS and CopilotKit's MIT-licensed OpenMuse. Everything else was written during the hackathon.

## License

MIT. See `LICENSE`.
