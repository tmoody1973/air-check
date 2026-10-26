# What to read in Tarik's other repos

All are `github.com/tmoody1973/<repo>`. Borrow patterns; write fresh code for the Air Check repo unless Tarik says otherwise. Licenses matter because the hackathon requires an OSI license on the submitted repo.

| Repo | License | Read these | Use for |
|---|---|---|---|
| `crate-cli` | none found (add MIT before copying anything) | `src/mcp-server.ts`, `src/servers/{musicbrainz,discogs,genius,lastfm,wikipedia,bandcamp,tool-registry}.ts`, `src/skills/{artist-deep-dive,sample-archaeology,scene-mapping}/SKILL.md` | Run as a separate research MCP service **outside the sandbox**. Disable `browser.ts` and the Bandcamp browser fallback; keep its 1.5 s rate limit. Do not use `show-prep` (talk breaks) or `vinyl-valuation` |
| `crate-web` | none found | `src/lib/openui/{library.ts,components.tsx,stream-adapter.ts,prompt.ts}`, `src/lib/openui-prompt.ts`, `package.json` (`@openuidev/react-lang ^0.1.3`, `react-ui ^0.9.18`, `react-headless ^0.7.9`) | OpenUI integration pattern. Register Air Check's own components. Call Nebius directly, not the hosted OpenUI Cloud gateway |
| `rhythm-lab-app` | **Business Source License 1.1 (not OSI)** | `app/api/auth/mixcloud/{authorize,callback,token,status,disconnect}/route.ts`, `lib/mixcloud/oauth.ts`, `lib/mixcloud/client-upload-v2.ts`, `lib/playlist-parser.ts`, `supabase/migrations/019_fix_mixcloud_oauth_for_profiles.sql` | Mixcloud OAuth (scope `upload`, CSRF state cookie, refresh token), upload field mapping, playlist parser. It uploads from the browser; Air Check uploads server-side so the token never reaches a browser. It sends `sections` with artist and song only. Tarik owns the code and may relicense copies as MIT; ask first |
| `TarikOS` | MIT | `src/app/api/agentmail/inbound/route.ts`, `src/lib/agentmail.ts`, `src/lib/agentmailLib.ts`, `src/proxy.ts`, `docs/superpowers/specs/2026-08-12-zola-inbox-design.md`, `tests/zolaMailGuardrail.test.ts`, `AGENTS.md` | AgentMail webhook (Svix signature checked against the raw body, idempotent on message id), allowlists, "mail is data never instructions", tests that fail if a send path appears. Uses Bearer auth against `https://api.agentmail.to/v0`. Also Clerk + Convex + Next.js setup |
| `rm-playlist-v2` | check | `packages/convex/convex/schema.ts`, `plays.ts` | Station play history. `plays` indexed `by_station_played_at`. Stations `88nine` and `hyfin` only |
| `thesysdev/open-intelligent-ui`, `thesysdev/openui` | MIT | READMEs | OpenUI Lang and packages (`@openuidev/lang-core`, `react-lang`, `react-ui`, `react-headless`) |

## Mixcloud upload API (checked against the developer docs, Oct 19)

`POST https://api.mixcloud.com/upload/`, multipart, OAuth 2.0 access token (browser-based authorization only). Fields: `mp3` (4 GB max; the Rhythm Lab app assumes about 250 MB, so keep the MP3 under that, for example 128 to 192 kbps), `name` (required), `description` (max 1,000 characters), `tags-0-tag` to `tags-4-tag`, `picture` (10 MB), `unlisted`, `sections-N-artist`, `sections-N-song`, `sections-N-start_time` (whole seconds, optional per docs). Pro only: `publish_date`, `disable_comments`, `hide_stats`, `hosts-N-username`. Audio is validated only after the full upload, so validate metadata first. Rate limit returns HTTP 403 with `Retry-After`.

## Data sources

See `PRIVATE_NOTES.md` for IDs. Box audio naming rules are in `skills/rlr-box-episode-assembly/SKILL.md`.
