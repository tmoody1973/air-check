# Plan 2: Nebius spikes

> **For agentic workers:** spikes are time-boxed investigations, not TDD tasks. Each one ends with a row in `docs/SPIKES.md` (Pass / Fail / Partial plus evidence) and any friction in `docs/FRICTION_LOG.md`. Commands that spend money, open ports or change cloud resources need Tarik's explicit OK first. The Nebius MCP runs in safe mode: anything with update or delete in it is handed to Tarik to run.

**Goal:** find out which parts of the approved architecture actually work on Nebius before Plans 3 to 5 are written on top of them.

**Spec:** `docs/superpowers/specs/2026-10-26-air-check-design.md`, sections 3.0, 3.1, 5.5 and 11. Spike definitions are in `BUILD_PLAN.md` "Day 1". Install facts are in `docs/NEBIUS_SETUP.md` and `docs/ARCHITECTURE.md` 3.1.

**Order:** risk first. V2b decides how the console talks to the agent, so it runs as soon as Hermes is up.

## Global constraints

- Region: **`us-north1`**, CLI profile `airc`. us-central1 was planned, but its non-GPU vCPU quota is 0 on this tenant (S0).
- VM: `cpu-d3` (Non-GPU AMD EPYC Genoa), preset `4vcpu-16gb`, Ubuntu 24.04, 100 GiB network SSD. Listed price (docs.nebius.com, effective Oct 1, 2026): $0.015 per vCPU-hour and $0.0045 per GiB-hour, so about **$0.132/hour, about $96/month**, plus disk at $0.071 per GiB-month (about $7.10/month for 100 GiB). This is Claude's calculation; the docs do not list a per-preset price. The preset can be changed later, because `allow_preset_change` is true.
- Only 80 and 443 (web) and 22 (SSH) are open. SSH is key-only with passwords disabled. It is not limited to one IP, because Tarik's home IP changes and an IP lock could shut him out (ruling S0). The NemoClaw dashboard (18789) and the Hermes API (8642) are bound to `127.0.0.1`.
- No credential ever goes into the repo, the chat or the sandbox. The Token Factory key lives in a root-only env file on the VM.
- Each spike has a stop limit of about 45 minutes. When it hits, record **Partial** or **Fail** and use the fallback written below.

## Spikes

| # | Spike | Pass | Fallback if it fails |
|---|---|---|---|
| S0 | **Provision.** Check billing and quota. Create the VM, using cloud-init with Tarik's SSH key. Install Docker and Compose. Firewall: 22 from Tarik's IP only, 443 open. | `ssh` works; `docker run hello-world` works; port scan shows only 22 and 443 | Fix billing or quota; try a smaller preset |
| V1 | **NemoClaw + Hermes install** (`NEMOCLAW_AGENT=hermes NEMOCLAW_SANDBOX_NAME=airc`) | `nemohermes airc status` healthy; an unapproved host is blocked and shown; activity log readable; shell available to the agent | Plain OpenShell + Hermes without NemoClaw (record it in friction) |
| V2 (part 2) | **Nemotron from inside the sandbox** (custom provider, `inference.local`) | Chat completion from inside the sandbox; the key is not visible inside the sandbox | Use the largest Nemotron that works; record limits |
| V2b | **Console ↔ Hermes API** (port 8642 over loopback) | A small script on the VM, outside the sandbox, sends a task and streams the reply | Telegram is the only control channel; the console shows state and approvals only |
| V3 | **Nemotron writes valid OpenUI Lang** (prompt pattern from crate-web `src/lib/openui-prompt.ts`) | 9 of 10 PackageCard generations validate | Constrained JSON mapped to components |
| V4 | **Hermes calls an MCP server** (Crate's `src/mcp-server.ts`, outside the sandbox) | A `musicbrainz_*` call returns data | A small Air Check MCP server wrapping the needed clients |
| V7 | **Convex read-only plays** (`by_station_played_at`) for `88nine` and `hyfin`; `rhythmlab` refused by `assertStation` | Returns rows | Seed a small fixture |
| V10 | **Nebius Serverless Job** on a CPU platform: download two WAVs, join them with ffmpeg, encode MP3, output the hash | The job finishes; its output is reachable by the publisher; cost is recorded | Media worker as a container on the VM (decision 004 fallback) |
| V11 | **OpenShell audit log readable** in near real time with time, action, destination and result | A blocked request shows up within a few seconds | Log at our own egress proxy instead |
| V12 | **Progress and stop for long jobs** (Hermes reports steps; can stop at a step boundary) | Both observed | Our tools write step rows; Take over stops between tool calls |

Deferred to the plans that need them: V5 and V6 (Mixcloud sections and backdating) go to the publisher plan, and V9 (Bandcamp Subsonic) goes to the Bandcamp plan.

## Done when

Every spike above has a row in `docs/SPIKES.md`. Tarik has seen a summary of what passed and what forced a fallback. Plans 3 to 5 are then written against the results.

## Teardown note

The VM bills about $0.13/hour while it runs. Judges must be able to test until Dec 15, 2026, so after the spikes either keep it running (about $96/month) or stop it between work sessions until submission. Stopping is a manual step for Tarik (safe mode).
