---
name: rlr-pre-air-verify
description: Before a Rhythm Lab Radio show airs, check every factual claim and verify flag in the Paper show notes against sources and the station's play history, and return corrections. Use on the Thursday and Friday before air, or on demand.
---

# Rhythm Lab Radio: pre-air verify

The Paper show notes are dense with release dates, credits, and artist history. Some were wrong in the past (the Jan 2026 notes had mismatched citations; the Oct 2026 notes are cleaner and carry an explicit "Pre-Air Verify List"). This skill closes that loop.

## Inputs
- The numbered notes Air Check gives you: Paper, pasted or Air Check's own notes for the upcoming show, including any `VERIFY` flags and the Pre-Air Verify List. Each line has an `L` id; refer to lines only by that id.
- Crate (MusicBrainz, Wikipedia, Bandcamp search, iTunes) and `source_search`.

## Steps
1. Extract claims per track: release date, label, album, credits, personnel, artist biography facts.
2. Check every item on the Pre-Air Verify List first. Then check release dates and label credits for all tracks.
3. For each claim, find at least two independent sources, or one primary source (label, artist, or press release). Cite each by the `[S…]` id your tools return.
4. Each claim ends `confirmed`, `conflict`, or `could-not-verify`; Air Check judges it from the sources you cite. Never mark `confirmed` from one weak source.
5. Station play context (last play on 88Nine or HYFIN) is added by Air Check. Do not look it up.
6. Submit one `research_submit` per line you check: its claims, and an optional replacement sentence for the line. Write no links in it; Air Check adds them. Air Check lists what is still open.

## Closing tracks
The last song of each hour is never talked about on air and has no show-notes entry. Air Check never offers you its lines. Do not flag a missing entry for it and do not research it.

## Style
- Flag, do not rewrite, on-air angles or opinions.
- If a claim is sensitive (health, legal, personal), say so and recommend care. Do not research beyond what the notes already contain.
- Keep the report short enough to read on a phone in two minutes.

## Delivery
Air Check shows the report in the console and sends Tarik the Telegram link. Do not edit the Paper doc itself.
