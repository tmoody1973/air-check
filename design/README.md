# Design mockups

`mockups/` holds the source of the clickable mock Tarik reviewed (a private claude.ai artifact, "Air Check Console Mock"):

- `Main.dc.html`: sign-in screen
- `Console.dc.html`: the console, with all views
- `canvas.json`: artboard layout

These files are written in a template format (`{{holes}}`, `<sc-if>`, `<sc-for>`, a small `DCLogic` class). They are **reference for layout, copy and behavior, not runnable as-is**. Rebuild the screens in Next.js and Tailwind using `DESIGN.md` tokens, after running the Impeccable design skill.

## Screens in the mock

| Screen | State and interaction | Notes |
|---|---|---|
| Sign-in | Links to the console | Google sign-in, work email limited to @radiomilwaukee.org, separate "demo workspace" door for judges |
| Today (digest) | Default view | Ready to approve, failed verification, new Bandcamp releases, blocked requests, Telegram preview. All sample data, tagged "Sample". Bandcamp rows are bracketed placeholders |
| Chat | Approve button toggles the approved state; "Review full package" opens the preview panel; chips jump to Episodes and Trust | Contains the generated PackageCard for the real 10-2-26 package |
| Package preview panel | Close button; Approve | Title, audio files, description excerpt, Hour 1 tracklist with closing-track chip |
| Episodes | Static table | Real 2026 status counts (29 ready, 2 no notes, 4 no audio, 7 blank Fridays) and known dates |
| Tracklist | Editable textarea; parses live | `HOUR 1` / `HOUR 2` markers, `Artist - Title` split, last good track of each hour marked closing, unparseable lines flagged |
| Trust and audit | Static table | Sample requests; one blocked |
| Release radar, Show plan, Skills and memory | Placeholder text only | Still to design. Show plan is now P1 and the weekly workflow |

## Not yet designed

- Release radar list (grouping by label, genre, date; status new / considering / played / passed)
- **Plan view (P1, design first among these):** theme cards (title, pitch, evidence links, candidate tracks marked past / radar / research, embargo and rotation flags), pick-to-draft, and deep-dive briefs beside the draft tracklist. The mock's "Show plan" is only a stub
- Skills and memory viewer, including the "what I learned" before-and-after diff after an edit
- "Where did this come from" provenance view for each package field
- Model panel (which Nemotron handled which step, time per call)
- Empty, loading, error and offline states
- Mobile layout checks (the mock stacks the sidebar and preview panel under 900px but was not tested)

Fonts: Instrument Serif, DM Sans, DM Mono (Google Fonts).
