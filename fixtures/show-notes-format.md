# Target show-notes format (structure only)

Taken from the shape of Tarik's Oct 23, 2026 Paper notes (Oct 29 ruling). Structure only; no show content is copied here.
`fixtures/show-notes-sample.md` is the golden render of this shape.

```
# Rhythm Lab Radio <date>
# Rhythm Lab Radio, Hour One: Show Notes
<1-3 sentence intro: what the hour is built around>
**Hour thread:** <connections across the hour, as prose>[[site](url)]
**Release dates:** <anything only days old, counted by code>
### 1. Artist, "Title"
- **Album and label:** <album or single, label, date, credits, length>[[site](url)] <next sentence>[[site](url)]
- **Chart:** <chart runs and awards>
- **Artist bio:** <born, where, formed, labels>
- **Story:** <the story behind the song>
- **Song:** <what the song is about, how it was made>
- **Samples and connections:** <samples, covers, links to other tracks>
- **Video:** <the video and who made it>
- **Fun fact:** <one odd, true detail>
- **On-air angle:** <one line, optional>
### 2. Artist, "Title"
- **What I could verify:** <the little that holds>
- **What I couldn't verify:** <what is missing, and the facts to check> **[verify]**
### 3. Artist, "Title"   (the hour's last track)
closing-track, no notes
# Rhythm Lab Radio, Hour Two: Show Notes
...
## Notes for Your Review
- **Artist, "Title":** <fact> (<reason>); <fact> (<reason>).
```

Observed conventions:
- Links follow each sentence, written `[[short host](url)]`: the host without `www.` and without its last label (`en.wikipedia`, `udiscovermusic`, `music.apple`).
- Bullets appear only when there is something to say, in the order above. Facts of one kind share one bullet of one to four sentences.
- A fact that holds has no marker. A fact to check ends **[verify]**; a conflict also gives both versions ("Sources disagree: en.wikipedia says X, instagram says Y."). The reason ("no source found", "only one source", "sources disagree") is only in Notes for Your Review.
- A fact with no source is kept and marked **[verify]** (decision 021). Never "I found no verified bio": a track with little found uses "What I could verify / What I couldn't verify".
- Hand-supplied notes are labeled "from your supplied notes, which I did not independently check".
- Closing tracks (the last track of each hour) get one line and no research (Hard Rule 4).
