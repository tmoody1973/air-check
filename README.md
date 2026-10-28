# Air Check

A private, always-on producer for Rhythm Lab Radio, Tarik Moody's weekly show on Radio Milwaukee. It helps plan each show, writes sourced show notes, checks facts before air, organizes release emails, and turns finished shows into Mixcloud-ready packages that publish only after a signed-in human approves them. The agent runs in a sandbox that can reach only an approved list of hosts, and every request it makes is logged where you can read it.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI Track.

**Status: in development.** What exists today is `packages/core`, the deterministic rules engine: tracklist parsing, closing-track marking, source reconciliation, Box episode assembly, title, tag and description checks, Mixcloud field mapping and the approval gate.

## Try it

The hosted demo is at https://aircheck.rhythmlabradio.com. Go to https://aircheck.rhythmlabradio.com/demo to enter the sample workspace with no account. It uses sample data only and cannot publish anything. Deploy steps are in `docs/DEPLOY.md`.

## Where it runs

Models run on Nebius Token Factory (NVIDIA Nemotron). Compute runs on Nebius AI Cloud. The agent is Hermes Agent in an OpenShell sandbox, installed with NVIDIA NemoClaw. Audio joining (ffmpeg) runs on the same Nebius VM. Sign-in (Clerk) and the app database (Convex) are hosted services.

## Develop

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
```

## Docs

- `docs/superpowers/specs/2026-10-26-air-check-design.md`: the approved design
- `docs/HANDOFF.md`: the original handoff brief
- `docs/PRD.md`, `docs/ARCHITECTURE.md`: requirements and architecture
- `docs/DEPLOY.md`: how the console is deployed, updated, rolled back and shut down
- `docs/decisions/`: decision log
- `skills/`: the station skills the agent loads

## What is pre-existing and what changed (draft)

Air Check is new work built for this hackathon. It calls Tarik Moody's existing Crate research service (MusicBrainz, Discogs, Genius, Last.fm, Wikipedia and Bandcamp lookups) over MCP, and borrows the OpenUI integration pattern from Crate Web and interaction patterns from CopilotKit's MIT-licensed OpenMuse. Everything else, including the agent skills, verification tools, ingest and publish pipeline, approval flow and console, was written during the hackathon.

Changed from the original plan: the audio join (ffmpeg turning a show's two hour-long WAV files into one MP3) runs as a small service on the Nebius VM instead of a Nebius Serverless Job. That was Tarik's call on Oct 27; decision 014 has the reasoning.

Mixcloud descriptions are drafted in Tarik's own voice, with any artist fact backed by a research source he can see, and a published show's description can be updated later, only with his approval (decision 015).

## License

MIT. See `LICENSE`.
