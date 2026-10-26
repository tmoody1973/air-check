---
name: rlr-pre-air-verify
description: Before a Rhythm Lab Radio show airs, check every factual claim and verify flag in the Paper show notes against sources and the station's play history, and return corrections. Use on the Thursday and Friday before air, or on demand.
---

# Rhythm Lab Radio: pre-air verify

The Paper show notes are dense with release dates, credits, and artist history. Some were wrong in the past (the Jan 2026 notes had mismatched citations; the Oct 2026 notes are cleaner and carry an explicit "Pre-Air Verify List"). This skill closes that loop.

## Inputs
- Paper notes for the upcoming show, including any `VERIFY` flags and the Pre-Air Verify List.
- Station play history in Convex, read-only, for the `88nine` and `hyfin` stations only. (Never the `rhythmlab` station: that is the 24/7 stream, not the weekly show.)
- Web search (Tavily) through the sandbox allow-list.

## Steps
1. Extract claims per track: release date, label, album, credits, personnel, artist biography facts.
2. Check every item on the Pre-Air Verify List first. Then check release dates and label credits for all tracks.
3. For each claim, find at least two independent sources, or one primary source (label, artist, or press release). Cite the URL for each.
4. Mark each claim `confirmed`, `conflict`, or `could-not-verify`. Never mark `confirmed` from one weak source.
5. Query Convex for each artist: last play on 88Nine or HYFIN, play count in the last 90 days, whether the track has been played. Report as context, not a claim.
6. Return corrections as exact replacement text for the notes, plus a short list of what is still open.

## Closing tracks
The last song of each hour is never talked about on air and has no show-notes entry. Do not flag a missing entry for it and do not research it.

## Style
- Flag, do not rewrite, on-air angles or opinions.
- If a claim is sensitive (health, legal, personal), say so and recommend care. Do not research beyond what the notes already contain.
- Keep the report short enough to read on a phone in two minutes.

## Delivery
Send the report over Telegram. Do not edit the Paper doc itself.
