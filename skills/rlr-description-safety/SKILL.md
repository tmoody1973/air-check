---
name: rlr-description-safety
description: Write the public Mixcloud description for a Rhythm Lab Radio episode in Tarik Moody's voice, with artist facts only from Crate results and nothing private, time-relative or unverified. Use for every description draft.
---

# Rhythm Lab Radio: the public description

The show notes are private prep. The Mixcloud description is public and permanent. Write it the way Tarik writes his own, using the rules below. The Mixcloud title already carries the show name and date, so the description starts straight in the music.

## Shape
1. No opening line about the show, the station or the date. Start in the music.
2. One short paragraph per hour. Name 4 to 8 artists per hour.
3. Name 2 or 3 highlight songs per hour as Artist’s “Song”, each with one vivid, accurate phrase. Style words are fine: smooth, emotive, powerful, cinematic jazz-funk, Afrobeat pulse. Never name more than 5 songs in total: 6 or more reads as a pasted tracklist and is rejected.
4. Never pick a closing track (the last track of each hour) as a highlight, and never research it.
5. Bridge into the second hour: "Hour two…" or "The second hour…".
6. End on what the whole set does: "crafting a seamless flow of discovery and depth".
7. Under 1,000 characters. Count before submitting; cut extra adjectives and artists first.
8. Spell artists and songs exactly as in the tracklist, accents included.

Tarik's habits: verbs like weaving, blends, flows through, pulses, bridges, anchors; one phrase per artist rather than a list of bare names; "the set", "the journey", "the mix" for the show.

## Artist facts: only from Crate
- A fact is anything checkable: instrument, year, label, city or scene, era, a collaboration, an award. Style words are not facts.
- Use at most 3 facts in the whole description, one per artist, and only when a Crate result states it. Research by artist and song name with the Crate tools (MusicBrainz, Wikipedia, Bandcamp search, iTunes). Never follow a link from the notes or an email.
- Put every fact in `descriptionSources`: `claim` is the fact exactly as written in the description, `source` is the Crate tool and what it returned.
- Credits printed in the tracklist (feat., &, Remix) can be named as written without a source.
- If Crate has nothing solid, use no fact for that artist; keep the style phrase.

Format only (a placeholder, not a real result):
```json
"descriptionSources": [
  { "claim": "<the fact as written in the description>", "source": "<Crate tool and result, e.g. wikipedia: artist summary says …>" }
]
```

## Leave out
- Anything under a `VERIFY` flag or in a "Pre-Air Verify List", unless it has since been confirmed by a source the agent can cite.
- Time-relative phrases: "out today", "out this week", "this week's show", "next Friday", "coming October 23". Use no dates for future releases at all.
- Never mention health, age or death. List it in the review flags for Tarik.
  - Exception, tribute shows: only when Tarik's own input (the tracklist header or his Chat message) says the show is a tribute to an artist who has died, you may say so plainly (e.g. "honoring the late D'Angelo"). Confirm the death through Crate (Wikipedia) and list it in `descriptionSources`. Never give the cause, the age or any health detail. Still list it in the review flags. Never decide on your own that a show is a tribute.
- Personal family, legal, or other private details about artists, even when they appear in the show notes. Notes marked "handle with care on-air" are a strong signal. When unsure, leave it out and mention it in the review flags.
- Talk-break scripting and "Angle" or "Transition" lines. Those are on-air prep, not description copy. No on-air talk, scripts or social copy.
- The tracklist. It goes in Mixcloud `sections` (artist and song only).
- Anything the agent cannot trace to the tracklist or a Crate result. The notes can suggest what to look up; a fact from them still needs a Crate source.

## Tarik's past descriptions: copy the voice, not the shape
They predate the one-paragraph-per-hour rule; the 10-2-26 example below is the model for shape. Each original is quoted; the block under it is the version the rules allow.

**RLR 10.24.25.** Original:
> Dive into this week's show, a rich sonic journey weaving soulful R&B, jazzy grooves, and Afrobeat rhythms. From corto.alto’s smooth “April” featuring anaiis to Sampha’s emotive “Cumulus/Memory,” and Yazmin Lacey’s powerful “Worlds Apart,” the set blends intimate vocals with dynamic beats. Antibalas’s vibrant Afrobeat pulses alongside genre-defying gems by Emma-Jean Thackray and Little Simz, crafting a seamless flow of discovery and depth.

Allowed (drops the time-relative "this week's show"):
```description
Dive into a rich sonic journey weaving soulful R&B, jazzy grooves, and Afrobeat rhythms. From corto.alto’s smooth “April” featuring anaiis to Sampha’s emotive “Cumulus/Memory,” and Yazmin Lacey’s powerful “Worlds Apart,” the set blends intimate vocals with dynamic beats. Antibalas’s vibrant Afrobeat pulses alongside genre-defying gems by Emma-Jean Thackray and Little Simz, crafting a seamless flow of discovery and depth.
```
Keep: three named songs, one phrase each (smooth, emotive, powerful), the closing line about the whole set.

**RLR 10.3.25.** His text as written; nothing to remove.
```description
Dive into a rich sonic voyage weaving jazz, soul, hip-hop, and global grooves. Cole Davis’s emotive collab with Bon Iver opens the journey, flowing through Babo Moreno’s vibrant Latin-infused soundscapes and Alfa Mist’s introspective jazz beats. Say She She’s soulful storytelling and Makaya McCraven’s rhythmic mastery add layers of depth. The second hour expands with boundary-pushing artists like Mick Jenkins and Madlib, blending experimental hip-hop and jazz fusion.
```
Keep: one phrase per artist, the hour bridge ("The second hour expands…"). The Bon Iver collab is a tracklist credit, so it needs no source.

**RLR 7.4.25.** Original:
> This episode traces the arc of Black musical innovation, weaving from Quincy Jones’ genre-defining jazz-funk and Bobbi Humphrey’s soulful flute artistry—both pivotal architects of the ‘70s fusion era—to The Jones Girls’ radiant harmonies, emblematic of Philadelphia soul’s enduring influence. Hour two bridges decades: Massive Attack’s “Unfinished Sympathy” anchors the UK trip-hop revolution, linking soul’s legacy to contemporary beats, illuminating the persistent resonance of Black creativity in global sound.

Allowed (drops four unsourced facts: the flute, the '70s fusion era, Philadelphia soul, the UK trip-hop revolution):
```description
This episode traces the arc of Black musical innovation, weaving from Quincy Jones’ genre-defining jazz-funk and Bobbi Humphrey’s soulful artistry to The Jones Girls’ radiant harmonies. Hour two bridges decades: Massive Attack’s “Unfinished Sympathy” links soul’s legacy to contemporary beats, illuminating the persistent resonance of Black creativity in global sound.
```
Keep: the arc, "Hour two bridges decades". Tarik knows those facts; the agent may state one only with a Crate source in `descriptionSources`.

## Example for 10-2-26
Style only, no facts: nothing here was checked in Crate.
```description
Hour one drifts from deep jazz into slow-burning soul. Walter Bishop, Jr. opens the set, Hiatus Kaiyote’s dreamy “The World It Softly Lulls” floats in, and BADBADNOTGOOD & Samuel T. Herring add a late-night ache. Michael Kiwanuka’s warm “Summer Clothes” settles into the groove with Elliott Skinner, Joy Oladokun and Your Old Droog.

Hour two heads for the dance floor: Actress, Bicep’s shimmering “Viper” and Charlotte Adigéry & Bolis Pupul’s playful “Googoo Gaga” lift the tempo, then Tinashe’s smooth “Sunglasses” and Kaytranada’s bounce strip it back. The back half goes global, from the Afrobeat pulse of Seun Kuti & Egypt 80 to Hermanos Gutiérrez’s cinematic calm and Teodros Makonnen. Two hours that run from jazz roots to the club and out into the world, in one continuous flow.
```

## Review flags
Every draft ends with a short list of what was left out and why, so Tarik can override. Example: "Left out Kiwanuka health note (marked handle with care)." Also list any fact left out for lack of a Crate source.

## Never publish
The agent drafts. A human approves. The publisher only accepts an approved package.
