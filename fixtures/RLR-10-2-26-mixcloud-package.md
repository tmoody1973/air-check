# GOLDEN FIXTURE: Mixcloud upload package (DRAFT, needs approval): Rhythm Lab Radio, 10-2-26

Status: prototype built from Box file metadata, the Drive tracklist and the Paper show notes. No audio has been processed.

## 1. Audio assembly plan

| Part | Box file | Box file id | Size (bytes) |
|---|---|---|---|
| Hour 1 | `10-2-26/9125.wav` | `<box-id-hour-1>` | 632,418,686 |
| Hour 2 | `10-2-26/9126.wav` | `<box-id-hour-2>` | 628,847,962 |

- Skipped in the same folder: `9101`-`9105` and `9201`-`9205` (broadcast segments), `9120.wav`, and the two "RLR Tonight at 6 / 8" spots.
- Join 9125 + 9126 in order, with no gap added. Encode to MP3 (Mixcloud does not take WAV; MP3 only).
- Expected length is about 1h59m if the files are 44.1 kHz / 16-bit stereo, which is consistent with your recent cloudcasts (about 7,000 s each). The agent should measure it from the audio rather than trust this estimate.
- No section start times are generated or sent (Tarik does not use them).

## 2. Title (your pattern: `RLR M.D.YY | lead artists and more`)

**RLR 10.2.26 | Michael Kiwanuka, Tinashe, Bicep, Kaytranada, Hiatus Kaiyote and more**

Alternates:
- RLR 10.2.26: Michael Kiwanuka, Tinashe, Bicep, Seun Kuti, Hermanos Gutiérrez and more
- RLR 10.2.26 | Walter Bishop Jr., Hiatus Kaiyote, Logic1000, Kaytranada, Tinashe and more

## 3. Tags (your 5 most-used genre tags)

Jazz, Electronic, R&B, Soul, Hip Hop

## 4. Description

Rhythm Lab Radio, week of October 2, 2026, hosted by Tarik Moody and produced by Radio Milwaukee.

Hour one runs from deep-jazz roots to new soul: Walter Bishop Jr.'s 1973 Black Jazz cut and Hiatus Kaiyote open the set, then it settles into a slow groove with Michael Kiwanuka, Elliott Skinner, Joy Oladokun and Your Old Droog.

Hour two starts on the dance floor with Actress, Bicep, Charlotte Adigéry & Bolis Pupul and Logic1000, then strips the electronics away through Tinashe, GENA and Kaytranada. The back half travels from Lagos to Mexico City to the Andes to Addis Ababa with Seun Kuti & Egypt 80, Son Rompe Pera, Hermanos Gutiérrez and Teodros Makonnen.

(The tracklist is NOT in the description. It goes in Mixcloud sections; see section 5. Description is 650 characters, under the 1,000 limit.)

(Written to avoid time-relative phrases like "out today" from the show notes, and to leave out the personal-health detail the notes flag as "handle with care on-air".)

## 5. Tracklist (Drive order, spellings normalized to the Paper notes)

### Hour 1
1. Walter Bishop, Jr. - "N'Dugu's Prayer"
2. Hiatus Kaiyote - "The World It Softly Lulls"
3. BADBADNOTGOOD & Samuel T. Herring - "Time Moves Slow"
4. Resavoir - "4th Cloud" feat. Gregory Uhlmann
5. Michael Kiwanuka - "Summer Clothes"
6. The Midnight Hour - "Water's Edge"
7. Elliott Skinner - "Don't Be A Runner"
8. Zoe's Shanghai - "Big big picture"
9. Joy Oladokun - "Easy Company"
10. Saigon Soul Revival - "Lý Qua Dub"
11. The Operator Sound INC. - "Appel En Attente (Call Waiting)"
12. Thee Sinseers & Joey Quiñones - "Let's Fall In Love (Again)"
13. Liv East - "Fever Dream"
14. Your Old Droog - "I Appreciate You" feat. Tarriona "Tank" Ball
15. Channell & 2bfrank - "Just Move"  (closing track)

### Hour 2
1. Actress - "Withending"
2. Bicep - "Viper" feat. Clark & Saskia
3. Charlotte Adigéry & Bolis Pupul - "Googoo Gaga"
4. Logic1000 - "Sparkle"
5. Tinashe - "Twentyfive Eight"
6. ISHA - "Feel At Home"
7. GENA - "Lead It Up (Kaytranada Remix)"
8. Kaytranada - "backstABS"
9. Tinashe - "Sunglasses"
10. Seun Kuti & Egypt 80 - "Problems" feat. Kabaka Pyramid
11. Son Rompe Pera - "Hagan Rueda"
12. Silvan Strauss - "All Bosses"
13. Hermanos Gutiérrez - "Los Ojos Del Cóndor"
14. ALA.NI & Adrian Younge - "Dusty Road"
15. Teodros Makonnen - "Libesh Kabashen"
16. SW2 vs EL-B - "Nightmare On Bascombe Street"  (closing track)

Sections carry artist and song only. No start times are generated or sent (Tarik does not use them).

## 6. Flags for you (the agent would raise these before asking for approval)

1. **Closing tracks (resolved).** Drive has one more track at the end of each hour than Paper: Hour 1 "Channell & 2bfrank - Just Move" and Hour 2 "SW2 vs EL-B - Nightmare On Bascombe Street". Per Tarik, the last song of each hour is never talked about, so it has no notes. Both are included as aired.
2. **Spelling cleanups applied.** Drive has "Ly Qua Dub", "Los Ojos Del Cndor" (dropped character), "Quinones", "Gutierrez", "Adigery". I used the Paper spellings with accents.
3. **Public vs private notes.** The Paper notes include a pre-air verify list (ALA.NI release date, Silvan Strauss project, ISHA credit wording, Tinashe label phrasing). I kept all of those claims out of the description.
4. **Time-sensitive phrasing.** Notes say "out TODAY", "out October 9", "out October 23". The description avoids them because the post will go up weeks later.
5. **Approval gate.** Nothing is published without your OK.

## 7. Reusable rules this prototype implies (candidate skills)

- `rlr-box-episode-assembly`: which Box files are hour 1 and hour 2, and which to skip, per naming era.
- `rlr-mixcloud-title`: `RLR M.D.YY | 4 to 6 lead artists and more`, with lead artists chosen from the notes' highlights.
- `rlr-mixcloud-tags`: five tags, drawn mostly from Jazz, Hip Hop, Electronic, R&B, Indie, Soul.
- `rlr-description-safety`: no time-relative phrases, no unverified claims, no personal-health details.
