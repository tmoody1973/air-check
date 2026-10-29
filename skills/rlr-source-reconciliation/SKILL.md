---
name: rlr-source-reconciliation
description: Reconcile the Rhythm Lab Radio tracklist across Google Drive, Dropbox Paper show notes, and Box audio, and ask Tarik when they disagree. Use before generating a package or a pre-air check.
---

# Rhythm Lab Radio: reconciling sources

Three sources describe the same episode. They disagree in predictable ways.

| Source | Holds | Weak spot |
|---|---|---|
| Google Drive doc `Rhythm Lab Radio <date>` | Final HOUR 1 / HOUR 2 tracklist, plain text | Typos and dropped characters (for example "Los Ojos Del Cndor", "Ly Qua Dub") |
| Dropbox Paper `Rhythm Lab Radio <date>` | Show notes: mostly artist bios and context, per track or per artist, in no fixed format | Not a track list; can omit tracks, and track lines carry extras like `(Michał Urbaniak)` |
| Box folder `<date>` | Audio: hour 1 and hour 2 | Naming varies by week |

## Rules
1. **Order comes from Drive.** The Drive list is the broadcast order.
2. **Spelling and diacritics come from Paper.** Prefer Paper when it has the accented or full form (Lý Qua Dub, Quiñones, Gutiérrez, Adigéry, Cóndor).
3. **Closing-track rule (confirmed by Tarik, Oct 19, 2026).** The last song of each hour is never talked about on air, so it normally has no entry in the Paper notes. Drive will therefore have exactly one more track at the end of each hour than Paper (seen on 10-2-26: "Channell & 2bfrank - Just Move" closing hour 1, "SW2 vs EL-B - Nightmare On Bascombe Street" closing hour 2). Treat these as aired and include them in the tracklist, marked `closing-track` (not an error). Do not ask about them and do not research or write about them.
   - **Drive decides (Tarik, Oct 28, 2026).** Notes are written about the artists, not as a track list, so a difference between the notes and Drive is never a question. Keep every Drive track; a track the notes don't match is `unverified-in-notes`, which is a label, not an error.
4. **Match by normalized title.** Lowercase, strip accents and punctuation, ignore `feat.` credits when matching, then compare.
5. **Never silently drop a track** and never silently add one.
6. **Date check.** Drive, Paper, and Box dates must agree. Known quirks: Paper file names like `10–02-26` (en dash) and `9-4-226` (typo); Drive titles like `10-2-2026` and `(evergreen)` suffixes. Normalize, then compare.
7. **Duplicates.** If two Drive docs share a date (for example a show-prep doc and the tracklist), use the one that has the HOUR 1 / HOUR 2 structure.

## Notes for new shows
For shows planned in Air Check, show notes are generated in the console (`rlr-show-notes`) and are not in Paper. Paper stays a read-only source for the 2026 backlog. If a new show has no Paper doc, that is not a mismatch.

## Output
A reconciled tracklist with a status per track (`confirmed`, `unverified-in-notes`, `spelling-fixed`, `closing-track`) and a list of questions for Tarik about real problems in the sources (duplicate docs, unreadable lines, a missing hour, dates). Never a question just because the notes and Drive differ. Questions are asked once and the answer is saved as an episode note.

## Learning
Save confirmed answers (for example "bonus tracks at the end of each hour are usually added after the notes are written") as patterns, not as permanent facts.
