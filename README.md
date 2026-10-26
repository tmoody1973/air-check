# Air Check

A private, always-on producer for Rhythm Lab Radio, Tarik Moody's weekly show on Radio Milwaukee. It helps plan each show, writes sourced show notes, checks facts before air, organizes release emails, and turns finished shows into Mixcloud-ready packages that publish only after a signed-in human approves them. The agent runs in a sandbox that can reach only an approved list of hosts, and every request it makes is logged where you can read it.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI Track.

**Status: in development.** What exists today is `packages/core`, the deterministic rules engine: tracklist parsing, closing-track marking, source reconciliation, Box episode assembly, title, tag and description checks, Mixcloud field mapping and the approval gate.

## Where it runs

Models run on Nebius Token Factory (NVIDIA Nemotron). Compute runs on Nebius AI Cloud. The agent is Hermes Agent in an OpenShell sandbox, installed with NVIDIA NemoClaw. Audio joining runs as a Nebius Serverless Job. Sign-in (Clerk) and the app database (Convex) are hosted services.

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
- `docs/decisions/`: decision log
- `skills/`: the station skills the agent loads

## What is pre-existing and what changed (draft)

Air Check is new work built for this hackathon. It calls Tarik Moody's existing Crate research service (MusicBrainz, Discogs, Genius, Last.fm, Wikipedia and Bandcamp lookups) over MCP, and borrows the OpenUI integration pattern from Crate Web and interaction patterns from CopilotKit's MIT-licensed OpenMuse. Everything else, including the agent skills, verification tools, ingest and publish pipeline, approval flow and console, was written during the hackathon.

## License

MIT. See `LICENSE`.
