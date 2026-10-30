# 025: Paste the Bandcamp player by hand while Bandcamp challenges the worker

**Decision.** When the ingest worker can't read a release's Bandcamp page, Tarik pastes the player code from Bandcamp's Share → Embed into the release, and Air Check reads the album or track id from what he pasted. Air Check does not try to get past Bandcamp's bot check.

**Why this came up.** On Oct 30 most new releases showed "No player". The saved links were correct album pages, and the parser read them correctly. But from the VM, Bandcamp answered the worker's automated requests with a "Client Challenge" page: a bot check, a few KB, no player. Bandcamp's own search page did the same. Switching to a request style the check doesn't catch would be getting around a bot check, which we won't do. The release radar's main use is listening to new music in the console, so a release with no player loses most of its value.

**Options.**
1. Paste the player by hand (chosen). About 10 seconds per release, Tarik's own browser does the Bandcamp visit, and nothing automated touches the challenge. Costs Tarik's time on every release that needs it.
2. Wait for the challenge to stop. Free, but unknown how long, and releases stay silent meanwhile.
3. Use the Bandcamp collection through Subsonic (the rl-record-store method). Only covers albums Tarik has bought, not promos.

**What we chose and why.** Option 1, Tarik's call (Oct 30). It works today, keeps Air Check honest with Bandcamp, and leaves the worker in place: if Bandcamp stops challenging it, players appear on their own again.

**What we gave up.** Automatic players for new promos while the challenge lasts. The worker now records `challenged` so the screen says what happened instead of "the page has no player".

**How we'll know if this was right.** The ingest log's `bandcamp-embed` lines: if `code=challenged` stays at most of them for a week, the manual step is the normal path and is worth making faster; if they return to `ok=true`, the paste box becomes a rare fallback.

**What actually happened.**
