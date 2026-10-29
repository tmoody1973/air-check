# 017: Fix backlog problems in Air Check, not in the source docs

**Decision.** When the Episodes page reports a problem with a backlog show (a broken tracklist line, two Drive docs for one date, an unclear Box folder), Tarik fixes it in the console. The fix is saved in Air Check as a correction for that show, and the scanner uses it instead of what Drive, Paper or Box say. Air Check never writes to Drive, Paper or Box.

**Why this came up.** The first live scan (Oct 28) left 15 real questions across 37 shows. Nearly all of them said "fix it in the doc": open Drive and delete a line, trash a duplicate Paper doc, rename a Box folder. The audio one said to copy two 600 MB files over a terminal by hand. Tarik works from his phone and is new to the terminal, so in practice those shows would sit unfixed, and the backlog would stall on the paperwork rather than the radio.

**Options.**
- **A. Save the fix in Air Check.** Air Check keeps a corrected copy per show (a fixed tracklist, which of two docs to use, which Box files are Hour 1 and Hour 2). Drive, Paper and Box stay read-only. Cost: Air Check and Drive can disagree (Drive still says "Donalyd Byrd"), so every corrected show needs a visible label and an undo.
- **B. Write the fix back into Drive and Box.** One source of truth. Cost: Air Check would need write access to Tarik's Drive and Box (today it has read-only access everywhere), a bad save would edit his archive, and writing to Paper is ruled out by Hard Rule 12.
- **C. Keep fixing in the source docs.** No new code. Cost: the problems described above; the terminal hand-copy in particular.

**What we chose and why.** A, Tarik's call (Oct 28). It keeps every permission read-only, it reuses the console's existing tracklist editor, and an undo ("Use Drive again") makes a wrong fix cheap.

**What we gave up.** Drive stops being the whole truth for a corrected show: someone reading the Drive doc later sees the old typo. And a correction can go stale: if Tarik later fixes Drive too, Air Check keeps using its own copy until he presses "Use Drive again".

**How we'll know if this was right.** Within a week of shipping, the Episodes page shows no question older than a few days, the April 17 show (refused 8 times on Oct 28) is drafted after a fix made in the console, and no one has had to copy audio by hand.

**What actually happened.**

