---
name: rlr-box-episode-assembly
description: Decide which Box files are hour 1 and hour 2 of a Rhythm Lab Radio episode, which to ignore, and when to stop and ask. Use before building any Mixcloud package.
---

# Rhythm Lab Radio: assembling an episode from Box

Source of truth for the weekly show audio is the Box folder `Rhythm Lab Radio / Full Episodes 2023-2026` (folder id in PRIVATE_NOTES.md, not committed). Each show is a dated subfolder. One Mixcloud cloudcast = hour 1 + hour 2 joined, about 2 hours.

Scope for this agent: shows from 2026-01-01 onward. Older eras are listed only so the matcher fails safely.

## Date from the folder name
- Folder names are `M-D-YY` (for example `10-2-26`, `1-16-26`). A zero-padded variant exists (`1-09-26`). Normalize before comparing.
- Cross-check the date against any `MMDDYY` suffix in file names. If they disagree, stop and ask.

## Picking the two hours (try in order, first full match wins)
1. `9125.wav` = hour 1 and `9126.wav` = hour 2. This is the normal pattern for 2023 onward.
2. `29934_Rhythm Lab Radio hour 1_Tarik Moody_MMDDYY.wav` and `29935_Rhythm Lab Radio hour 2_Tarik Moody_MMDDYY.wav`. Seen in 2026 on 5-22-26 and 8-21-26.
3. `RLR - Full Hour 1 - MMDDYY.wav` and `RLR- Full Hour 2 - MMDDYY.wav` (note the inconsistent spacing). Seen on 3-20-26.
4. Older and one-off variants, accepted only if both hours match each other: `9125 - Hour 1.wav` / `9126 - Hour 2.wav`, `Hour One (9125).wav` / `Hour Two (9126).wav`, `9125 - HOUR 1 - FULL.wav` / `9126 - HOUR 2 - FULL.wav`, `9125_MMDDYY.wav` / `9126_MMDDYY.wav`.

## Always ignore
- `9101`-`9105` and `9201`-`9205` (broadcast segments of the same hours; do not join these).
- `9120.wav`, `RLR Tonight at 6...`, `RLR Tonight at 8...` (promo and billboard spots).
- `.DS_Store` and anything not `.wav`.
- Folders named with `RECAP`, `Best of`, or similar special names: do not auto-assemble. Ask first.

## Sanity checks before an episode is "ready"
- Both hours must exist. If only one does, status is `incomplete`; do not build a package.
- Each hour is normally 570 to 660 MB (about one hour of 16-bit stereo WAV). Outside that range, flag it.
- Hour 1 and hour 2 should differ by less than about 10% in size. Larger gaps usually mean a truncated file.
- Do not assume a folder exists for every Friday. Missing weeks are normal (off-air weeks); report them, do not invent them.

## Output
Return: folder id, date, hour 1 file id and size, hour 2 file id and size, which pattern matched, ignored files, and any flags. Save the matched pattern name so the next run can try it first.

## Learning
If Tarik confirms a new naming pattern or an exception, append it here as a numbered pattern. Never delete an old pattern.
