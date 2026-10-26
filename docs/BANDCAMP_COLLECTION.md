# Bandcamp collection source (Subsonic API, open beta)

Researched Oct 19, 2026. Sources at the bottom. Anything not in a source is marked **(confirm)** and is a Day 1 spike (V9).

## What it is
Bandcamp added a Subsonic-compatible API in open beta (announced July 16 to 17, 2026). A fan enables it in Fan Settings, generates a dedicated username and password (separate from the login, revocable), and points a client at `https://bandcamp.com/api/subsonic`. Bandcamp names Amperfy, Feishin and Submariner as supported clients.

## Questions asked, and what the evidence says

### 1. Does the beta cover Tarik's account and expose the whole collection?
- It is a **fan-account** feature. Nothing found requires a paid or special account type. Tarik's own fan account is the one that matters.
- It exposes the **purchased collection**. One independent tester listed 1,607 purchased tracks through it. Library views were "Recent", "All" and "Random purchases".
- Wishlist and followed artists are **not** mentioned anywhere. Assume not available. **(confirm)**
- Bandcamp warns large collections may be slow. A 1,200+ item collection is in the range where that matters, so sync nightly into a cache and never query live.
- Whether his collection is complete (older purchases, gifted items, label-sent codes) can only be checked by listing it. **(confirm in V9: count items against the count on his Bandcamp collection page.)**

### 2. Do the terms allow this kind of use?
- Bandcamp's Terms of Use say nothing about APIs, scraping or automated access, and nothing about Subsonic. They reference an Acceptable Use policy whose text was not retrievable.
- They do say the service and its content are for **personal, non-commercial use**, and bar storing or reproducing content beyond that without permission.
- Reading: a station producer using his own fan account to plan a show is a gray area, because the show is broadcast. Metadata (artist, title, album, label, year) kept to plan his own show is lighter than audio. Audio is the part to avoid.
- Decision for Air Check: **metadata only. No audio is streamed, downloaded or stored.** The credential is Tarik's own, held by the ingest worker only, and revocable in Fan Settings. The demo workspace uses sample data, never his collection.
- This is not legal advice. Before the hackathon video or any public repo claims "reads your Bandcamp collection", Tarik should decide whether to email Bandcamp support to confirm the use is fine. The repo and video should call it a beta personal-account feature.

### 3. Can a tracklist line be matched to an owned item beyond text search?
- No identifier-based lookup was found. Standard Subsonic offers artist, album and search calls, but which of them Bandcamp implements is **not documented**. One tester confirmed browsing and collection search work, which suggests browse and search endpoints exist, but did not name them. **(confirm in V9)**
- Therefore **do the matching in our own code**, not through the API: sync the whole collection nightly into a `collection` table (artist, album, track title, label if present, year, Bandcamp item id), then match a tracklist line against that table.
- Matching reuses the normalization in `rlr-source-reconciliation` (lowercase, strip accents and punctuation, ignore `feat.` credits). Report `owned`, `owned-different-spelling` (fuzzy, shown for Tarik to confirm) or `not-in-collection`. Never auto-confirm a fuzzy match.
- Note: Bandcamp item data may not carry the label. If missing, take the label from MusicBrainz or Discogs through Crate.

## Observed quirks to plan for
- Endpoints need the `.view` suffix. Bad credentials return a bare HTTP 500, and `ping` says ok even with wrong credentials, so it cannot validate the key.
- `ping` returned XML even when JSON was requested (one report). Another tester got JSON for other calls. Handle both formats.
- Unimplemented endpoints return HTTP 200 without the usual `subsonic-response` envelope. Treat a missing envelope as an error.
- Auth is the standard Subsonic token scheme: username `u`, token `t` (MD5 of password plus salt), salt `s`, version `v`, client `c`.
- Streams are 128 kbps MP3 behind a `bcbits.com` redirect, with credentials in the URL. Air Check does not use streams.
- Playlists were added to the beta later. Library rows are read-only. Adding a track to a playlist works only for items already in the collection, one track per call.
- No documented rate limits. Honor HTTP 429 and `Retry-After`. The beta can change without notice.

## How it fits Air Check
- **Ingest worker** holds the Subsonic credentials and syncs nightly. The agent never sees them (same rule as Box, Drive, Mixcloud).
- Convex `collection` table (metadata only). Read-only agent tools: `get_collection(query)` and `check_owned(tracklist)`.
- **Theme ideas:** candidate tracks carry an `in your collection` tag, and ideas can draw on owned items that have not been played on Rhythm Lab (gaps in his own shelf).
- **Tracklist check:** each draft line shows owned or not-in-collection.
- **Show notes:** an owned item has a Bandcamp page, a primary source for date, label and credits.
- **Optional, later:** write a planned show back as a Bandcamp playlist after Tarik approves. Needs a human approval like the Mixcloud publish, and only works for owned items. Not in the first version.

## Priority
P2 if V9 fails or runs long, P1-light if V9 passes in under an hour: the `in your collection` tag on theme cards is cheap once the table exists. Cut before the radar.

## V9 spike (add to Day 1 list, 45 minutes)
1. Tarik enables Subsonic in Fan Settings and generates credentials (he does this, not the agent).
2. From the ingest worker, call the browse and search endpoints with token auth; note which return data.
3. List the whole collection and compare the count to his Bandcamp collection page.
4. Time it. If a full sync takes more than a few minutes, page it and run it nightly.
5. Record results in `docs/SPIKES.md`.
**Pass:** a count within a few percent of his real collection, with artist, album and track titles. **If it fails:** drop to a one-time export of his collection list (Bandcamp has no official collection export that we found), or skip the feature and keep the Bandcamp email radar.

## Sources
- Bandcamp blog, July 16, 2026: https://blog.bandcamp.com/2026/07/16/discover-improvements-and-subsonic-implementation/
- cliamp pull request with live endpoint notes (Aug 25, 2026): https://github.com/bjarneo/cliamp/pull/521
- Music Assistant compatibility issue (auth scheme, XML ping): https://github.com/music-assistant/support/issues/5878
- Soundiiz setup article: https://support.soundiiz.com/hc/en-us/articles/37332766943378-How-to-Connect-Bandcamp-to-Soundiiz-with-Subsonic
- Phonotonal write-up: https://www.phonotonal.com/2026/07/bandcamp-adds-subsonic/
- Bandcamp Terms of Use: https://bandcamp.com/terms_of_use

## Persistent player (decided Oct 19, P2, after V9)
A mini player bar stays fixed at the bottom of the console, so audio keeps playing while Tarik moves between Plan, Today and Episodes. It plays only items in his own collection.

**What it does**
- Play a candidate from a theme card, or a line from the draft tracklist (if the match is `owned`).
- Queue = the draft tracklist in order. Play, pause, next, previous, seek, volume. Shows artist, title, album, artwork.
- Reorder the queue by dragging draft lines; the draft updates (single source of truth is the draft).
- Keyboard: space to play or pause.

**How it streams**
- A console server route builds the signed Subsonic stream URL and proxies it. The browser never receives the Bandcamp credentials. Stream only: no download, no caching to disk, no recording.
- Use one HTML `<audio>` element owned by a provider at the app root, so route changes do not interrupt playback.
- Streams are 128 kbps MP3 behind a `bcbits.com` redirect. The proxy must follow the redirect, pass `Range` headers (seeking), and handle HTTP 500 on bad credentials.
- The agent has no access to the stream. It knows only the `collection` rows.

**Demo and safety**
- The judge demo workspace has no player on Tarik's collection. It plays two royalty-free sample clips or hides the bar.
- Only a signed-in @radiomilwaukee.org user can hit the stream route. Rate limit it.

**Reference: Feishin (https://github.com/jeffvli/feishin)**
- Open-source Subsonic/OpenSubsonic player (Electron + Vite, React, web player backend; a hosted web build and a Docker image exist). Bandcamp lists it as a supported client.
- **License is GPL-3.0.** Air Check's repo must be MIT or Apache-2.0 for the hackathon, so **do not copy Feishin code.** Read it for ideas (queue model, seek handling, auth flow) and write our own small player.
- Do not embed or fork Feishin. A separate Feishin container (aggregate use) would not give a persistent in-console queue tied to the draft, so it is not the plan.
- The page did not describe its source layout, so the reference value is unconfirmed until someone opens the code. Claude Code should skim `src/` for how the web player handles queue state and `Range` seeking before building.

**Add to V9:** from the console server, fetch one stream through the proxy and play it in an `<audio>` element in a browser, including a seek. Pass: plays and seeks. Fail: drop the player; the collection tags still work.
