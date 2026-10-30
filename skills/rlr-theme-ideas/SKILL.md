---
name: rlr-theme-ideas
description: Suggest 3 to 5 theme ideas for an upcoming Rhythm Lab Radio show from Tarik's own show history, labels and artists he plays, the Bandcamp release radar and the morning digest. Use when Tarik opens the Plan view, asks for show ideas, or wants a theme show.
---

# Rhythm Lab Radio: theme ideas

Tarik plans each show ahead of time and voice-tracks it. This skill gives him starting points for a theme. It suggests; he chooses.

## Inputs (read only)
- Show history: every parsed tracklist (2026 backlog from Drive plus shows typed in the console). This is what Rhythm Lab has actually played.
- Counts computed by code, not by you: plays per artist and label, last time each was played, gaps (played often, then dropped), clusters (artists who share labels, bands or years).
- Release radar: `releases` records with status `new` or `considering`, with label, release date and embargo.
- Morning digest items.
- Station play history for `88nine` and `hyfin` only, as context ("already in heavy rotation on HYFIN"). Never the `rhythmlab` stream, and never as a record of what the show played.
- The `collection` table (metadata of Tarik's purchased Bandcamp items), when present: tag candidates `in your collection`, and note owned items Rhythm Lab has not played. Never claim ownership without a matching row.
- Crate lookups (MusicBrainz, Discogs, Wikipedia) and source_search (web search through Air Check) for facts that make a theme work.

## Output: 3 to 5 ideas, each with
1. A working title and a one-sentence pitch.
2. Why it works now: the evidence, each item linked to a past show, a radar record or a source. Example: "You played three Brownswood releases in March and May; two new Brownswood records are on the radar."
3. 8 to 12 candidate tracks, each marked: from past shows, from the radar, or from research. Show embargo status and whether it is already in heavy station rotation.
4. What is missing or unverified.

## Rules
- Counts and dates come from the code-computed stats. Do not estimate them.
- Every factual claim (anniversaries, who played on what, label history) has a source or is marked `could-not-verify`. Do not claim an anniversary without one.
- Embargoed releases may be suggested in the private Plan view only, marked with the embargo date. Never put them in any public text.
- Candidate lists are not ordered, so there is no closing track yet. Once Tarik orders a draft, the last song of each hour is a closing track and is never researched or discussed.
- No scripts, no talk, no break copy. These are ideas and evidence.
- When Tarik picks, rejects or edits an idea, record what he chose and why so the next batch improves.
- Do not suggest more than five. Tell him plainly if the history is too thin for a good idea.
