# 023: A deep dive is a researched article, like our own Wikipedia page, not a list of facts

**Decision.** A deep dive's brief becomes an encyclopedia-style article: an infobox (a small box of key facts such as origin, years active and labels), a short lead paragraph, sections (Origins, Career, Sound and influences, Key records, Legacy) written as prose, the existing "Connects to your list", what could not be verified, and numbered references. Code runs five web searches on the subject when the job starts, the same way show notes already get their first searches (decision 022), and the agent must read them before it can save the brief.

**Why this came up.** On Oct 30 Tarik said: "The brief should be a narrative." "It should be deeper research for briefs." "It should feel like our own custom Wikipedia page." Until then a deep dive was 5 to 8 bullet facts, and the agent looked things up one at a time, so most of the run was the model waiting between its own tool calls. What was at stake: a deep dive that is too thin to plan a show segment from, and too slow to be worth asking for.

**Options.**
- **A. Code runs five searches up front; the agent writes one sentence per claim, tagged by section; code assembles the article (chosen).** Each claim stays one sourced sentence, so the existing fact checker, [verify] marks and source links keep working unchanged. Cost: 5 counted web searches (10 Tavily credits) per deep dive before the agent's own (up to 4 more), and a longer model answer (up to 39 claims instead of 11).
- **B. Let the model write free paragraphs.** Reads most naturally. Cost: a paragraph can hold several facts with one source between them, so code can no longer check each fact against its source, and a sentence with no source would be hidden inside a paragraph instead of marked. That breaks the sourcing rule for deep dives (Hard Rule 10).
- **C. Keep bullets, only raise the count.** Smallest change. Cost: it is still a list, not the narrative Tarik asked for, and still slow because the agent searches one step at a time.

**What we chose and why.** A. Tarik asked for the narrative and the deeper research (Oct 30); the coordinator chose the shape; Claude built it. Code joins a section's sentences into one paragraph in the order the agent sent them, numbers references by where they first appear, and writes every heading, the infobox labels, the checks and the "On Rhythm Lab" line itself; only the sentences come from the model. The page and the Paper export render the same structure from one function, so they cannot drift apart. Older briefs still render: their kinds map onto the new sections (a bio goes under Origins, a fun fact under Legacy).

**What we gave up.**
- Search budget: 5 searches per deep dive against the daily caps of 100 (real) and 20 (demo). Four deep dives use the whole demo day before any show notes run.
- Longer model output and a longer run per deep dive: up to 39 claims to write, though the five searches run in parallel, not one per turn.
- Prose stitched from separate sentences can read a little choppy; the skill tells the agent to write each sentence to follow the one before, but nothing in code checks the flow.
- The infobox only takes a fixed list of ten fields (Origin, Years active, Genres, Labels, Members, Founded, Founders, Released, Label, Producer). Anything else must go in the prose.
- A brief with fewer than 10 sourced facts now shows the "Only N facts could be sourced" warning, so every older brief (5 to 8 facts) shows it.

**How we'll know if this was right.**
- Tarik reads the next three deep dives and says they read as a narrative he would plan a segment from, without rewriting them.
- The bridge log for a deep dive shows `prefetch searches=5 ok=5` and the brief saves with 15 or more section facts, most of them sourced (not [verify]).
- Time one deep dive on the same subject before and after this change: the after run is no slower, even though it writes about three times as much.

**What actually happened.**
