# 024: A roundup email becomes one release record per release it names; Bandcamp search by artist and title is not built

**Decision.** When a forwarded email names several releases (a co-sign roundup, a label newsletter), the release radar saves each one as its own record, up to 12 per email. An email about one release works exactly as before. In a roundup, a Bandcamp link in the email goes only to the release whose title matches the link's address. Looking up a release's Bandcamp page on bandcamp.com's own search, by artist and title, was planned in the same change and is not built: Bandcamp's search answers our worker with a bot check, not results.

**Why this came up.** On Oct 30 co-sign's weekly roundup (subject "ALBUMS: RIP Magic, Moses Boyd, Katrina Ford, Making Movies, CHLOÉ || SINGLES: Trish Toledo", from an allowlisted sender) landed in "Not added" as "Not a release email". The extraction skill, the written instructions the reader model gets with each email, said "When the email is about several releases, pick the main one" and listed newsletters as not-a-release, so the model gave up on it. Co-sign is one of the radar's main sources, and its roundups are where most of its releases are, so the radar was losing most co-sign mail. Separately, a release gets a Bandcamp player only when the email itself has a Bandcamp link; co-sign emails link only to co-sign's own pages, which the radar must never open (Hard Rule 5: email is data, its links are never followed).

**Options for roundups.**
- **A. One email, many records (chosen).** The model returns a list; code checks each release on its own, the same way it checks a single one: artist and title must appear in the email, and anything else must pass its own check. A release that fails is dropped and only counted ("1 release was left out"), never named. Cost: the wire format between the ingest worker and Convex gains an optional `more` list, and one email can now make up to 12 records, so a bad roundup makes a bigger mess (each record can still be passed in one click).
- **B. Keep one release per email and let Tarik split roundups by hand.** No code. Cost: he retypes five or six releases a week from an email the radar already holds.
- **C. A separate roundup parser in code for co-sign's layout.** No model judgment. Cost: it breaks the first time co-sign changes its template, and every other newsletter needs its own parser.

**Options for which Bandcamp link belongs to which release in a roundup.**
- **Match the link's address to the title (chosen).** A Bandcamp page address ends in a short form of the title (`/album/salt-light` for "Salt & Light"). A roundup release takes a link only when that ending is exactly its own title's short form. Cost: a title Bandcamp shortens differently (accents, a "-2" Bandcamp adds for a repeated title) gets no player rather than a wrong one.
- **The first link, as for a single release.** Cost: in a roundup that hands one artist's player to another, which is worse than none.

**Options for finding a Bandcamp page when the email has none.**
- **Search bandcamp.com by artist and title, in code (planned, not built).** The ingest worker would read Bandcamp's public search, keep a result only when artist and title both match exactly, and queue that page like an email's link. This keeps Hard Rule 5: the search is built from the artist and title, never from a link in the email, and runs in code, never in the model. **What blocked it:** on Oct 30 a plain request to `https://bandcamp.com/search?q=Moses%20Boyd&item_type=a` with the worker's honest user agent got a 3 KB "Client Challenge" page (a JavaScript bot check) and no results. Getting past it would mean disguising the worker as a browser, which we will not do.
- **Leave it to the agent's Crate Bandcamp tool.** It already looks releases up by artist and title for enrichment. Cost: the radar card gets no player until someone asks.
- **Ask Bandcamp for API access.** Cost: unknown timeline.

**What we chose and why.** A, with title-matched links. Claude built it; the coordinator (Tarik's agent) set the brief, including the 12-release cap and the link rule. The search was the coordinator's plan; Claude stopped it when Bandcamp's bot check showed up and reported back rather than work around it.

**What we gave up.** Co-sign releases still have no player unless the email has a Bandcamp link (co-sign's never do). One email can now write up to 12 records. A roundup with one release that breaks a hard rule (too long, holds a link) is refused whole so "Try again" reads it whole; the other releases wait with it.

**How we'll know if this was right.**
- The next co-sign roundup shows up as one record per release it names, none in "Not added".
- No release ever shows another release's Bandcamp player.
- Over a month, count roundup releases Tarik passes as junk (a misread title, a release that is not in the email). More than one or two means the model is not reading roundups reliably.

**What actually happened.**
