# 021: Private show notes and deep dives keep facts with no source, marked [verify]. Public descriptions stay strict.

**Decision.** When the agent knows a fact about a track but found no source for it, Air Check now keeps the fact in the private show notes (and deep dives) and marks it **[verify]**, with the reason "No source found." listed under Notes for Your Review. Before, it threw the fact away. Nothing marked **[verify]** can reach a public Mixcloud description.

**Why this came up.** On Oct 29 Tarik ran Air Check's show notes on six real tracks. He called them useless: lines of metadata, "Only one source: musicbrainz.org" after almost every fact, "I found no verified bio", and no stories. The skill told the agent "No source, no sentence", and the save step dropped any fact with no source. So the notes left out exactly what makes his Paper notes worth reading: the story behind a song, chart runs, awards, samples, fun facts. His ruling, verbatim: "you can use unverified info, you don't have to refuse it, I can confirm it myself." What was at stake: notes so thin that he goes back to the Perplexity prompt, or notes that pass off guesses as facts.

**Options.**
- **A. Keep unsourced facts in private notes, marked [verify] (chosen).** The agent may write a fact it found no source for; code saves it as could-not-verify ("No source found."), shows it with **[verify]**, and lists it for review. Cost: the notes can now hold wrong facts, so they are only as safe as the marker and Tarik's check before air.
- **B. Keep refusing unsourced facts, and push the agent to search harder.** The notes stay clean, but searches are capped per day and slow (about three minutes of model time a track on Oct 29), and many true details (an award, a video's director) do not show up in the first results. Cost: the notes stay thin, which is the problem Tarik reported.
- **C. Allow unsourced facts everywhere, including the draft's notes.** The most text for the description writer. Cost: breaks Hard Rule 6 (no unverified claims in a public description). A wrong fact could go out on Mixcloud under the station's name.

**What we chose and why.** A. Tarik's call (Oct 29, 21:45), implemented by Claude. Show notes and deep dives are private research for one reader who checks them before air; the **[verify]** marker and the Notes for Your Review list tell him exactly what to check. The public path is unchanged and stays strict in code: the draft's notes (what a description is written from) take confirmed and sourced facts only, and a test fails if an unsourced fact gets through. A pre-air check still drops a claim with no source, because its job is to source a line.

**What we gave up.**
- The "every fact has a source" promise no longer holds for the private notes. It now reads: every fact shows its sources, or says it has none.
- A guess the model is wrong about can sit in the notes until Tarik reads it. The skill tells the agent not to guess specifics such as dates and numbers, but that is a prompt, not a check.
- More **[verify]** markers for Tarik to read before air.

**How we'll know if this was right.**
- On the next real show, Tarik reads the notes beside his Oct 23 Paper notes and says he would use them.
- Of the facts marked "No source found." in the next four shows, he finds most of them true (the agent is not inventing).
- No unsourced fact ever appears in a draft's notes or a Mixcloud description (the tests pin this).

**What actually happened.**
