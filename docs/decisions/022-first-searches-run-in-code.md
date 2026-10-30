# 022: Each show-notes track's first web search runs in code, in parallel, before the agent writes

**Decision.** When the agent starts on a show-notes job, the bridge (the small server on the VM that holds the search key) runs every track's first web search at once, five at a time, and hands the agent each track's results when it asks for them with a new tool, `first_search`. The agent no longer runs that search itself; it still may search for gaps with `source_search`.

**Why this came up.** On Oct 29 Tarik ran one Tavily search by hand (the same query Air Check uses, advanced depth) and it answered in 4.7 seconds. Air Check's agent took about 3 minutes per track. The bridge logs showed searches taking 1 to 5 seconds; nearly all the time was the model thinking between tool calls. Tavily's own guidance for many queries is to run them in parallel and give the model the gathered results to analyze. What was at stake: show notes for a 28-track show taking well over an hour, which is too slow to use on a show day.

**Options.**
- **A. A bridge tool that starts the whole batch on its first call (chosen).** The agent calls `first_search` for its first track; code asks Convex (the app's database) for the job's tracks and runs all their searches in parallel; each later call returns that track's results at once. Cost: one tool call per track remains, and the batch starts when the agent first asks, not the instant the job is queued (seconds apart in practice).
- **B. Put every track's results into the agent's starting instruction.** The relay (the service that hands jobs to the agent) or Convex would run the searches and paste the results into the prompt. Cost: the relay and Convex would need the search key, breaking the rule that only the bridge holds it; the source ids (short labels like `S7k2q` that the agent cites) live in the bridge's memory, so results pasted elsewhere could not be cited; and 28 tracks of results is about 340 KB of text in one message.
- **C. Keep the agent searching, and only tell it to search less.** No new code. Cost: each search still waits for the model's next turn, so it saves little.

**What we chose and why.** A. Claude proposed it; the brief (Tarik's coordinator, Oct 29) asked for code-run, parallel first searches with Tavily's batch settings. It reuses what exists: the same search client, the same source ledger and ids, the same daily cap and embargo check in Convex (each prefetched search is counted and checked exactly like a `source_search`). It adds two small Convex routes: a read-only one that lists the job's tracks to search, and one that gives back failed searches (only successful ones count against the cap) and records the Tavily credits each answer reports, shown in Settings.

**Addendum (Oct 29, 23:00): the model is not trusted to ask.** In a live run at 22:33 with the new prompt, the agent made one web search in 20 minutes and went to MusicBrainz instead, despite the prompt. So two changes, the coordinator's call, built by Claude:
- **The relay starts the batch.** As the relay (the service that hands runs to the agent, on the same machine as the bridge) starts a research run, it calls the bridge's new `<route>/prefetch` address with the job id, using that route's existing MCP token. It is not an agent tool. The agent's own first call stays as the fallback.
- **Code makes the agent read it.** `research_submit` refuses a show-notes track ("Call first_search for H1.2 first; its results are ready.") until `first_search` has returned that track's results in this job, unless its search failed, the cap ran out or the track is embargoed. Intros and threads are never held.
- **Smaller results.** `first_search` shows ids, titles, dates and up to 1,200 characters of chunks per result, no URLs: about 8 KB a track at most, against about 12 KB before.
- Cost: the relay now holds the two bridge MCP tokens (it could call any agent tool; it is our own code on the same machine), and a refused submit costs the agent a turn the first time it skips.

**What we gave up.**
- The agent still spends one tool call per track reading its results. A per-hour call would save turns but put about 170 KB in one message.
- The batch is kept in the bridge's memory for 12 hours. A bridge restart forgets it, and the next call searches again (counted against the cap again).
- Prefetching searches every track left in the job, even ones the agent might not reach before a run ends. A continuation reuses them, so this costs credits only when a job is abandoned.
- The prompt's "web searches left today" number is read when the run is queued, before the prefetch counts its searches, so it reads high by up to the number of tracks.
- Tavily's advice to drop a URL's query string was not followed: it would merge every YouTube video into one source. Only tracking parameters, fragments and trailing slashes are dropped.

**How we'll know if this was right.**
- The same 8-track test list, timed before and after: the after time is clearly shorter. Prediction for 28 tracks: the batch itself takes about 30 seconds (6 rounds of 5 searches at about 5 seconds each) while the agent writes its first track; the whole job drops from about 85 minutes (3 minutes a track on Oct 29) to about 45 to 55, because each track needs 3 or 4 model turns instead of 5 or 6. If it drops much less, the model's turns, not the searches, are the cost, and the next step is to hand the agent several tracks' results per call.
- The bridge log line `prefetch searches=… ok=… failed=… ms=…` (named `tracks=` until Oct 30) shows the whole batch finishing in well under a minute, with few failures.
- The notes are no thinner than before: Tarik reads the next show's notes and the per-track facts are as rich as on Oct 29.

**Addendum, Oct 30 (Tarik).** First live run: 6 tracks searched in 10.5 seconds, and track 1 written in 46 seconds (about 3 minutes on Oct 29). The agent then read only Wikipedia, so code now runs a second search per track in the same batch, `<Artist> - "<Title>" interviews, reviews and samples` (Tarik chose the three topics). Cost: 2 more credits and 1 more counted search a track (56 of the 100-a-day cap for a 28-track show), no extra model time; the agent's own budget stays at 3 web searches a track, the two included.

**What actually happened.**
