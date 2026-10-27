import type { PackageDraft } from "@aircheck/core";

// Inline copy of the golden 10-2-26 package (Convex cannot read fixture files).
// seed.test.ts asserts these deep-equal goldenDraft(), so they cannot drift.
export const DEMO_MP3_SHA256 = "5e07fc83b02bc5a38645f21ba7093fe8b7190087f4221ab21338427bce9ac106";

export const GOLDEN_TITLE = "RLR 10.2.26 | Michael Kiwanuka, Tinashe, Bicep, Kaytranada, Hiatus Kaiyote and more";
export const GOLDEN_ALTERNATES = ["RLR 10.2.26: Michael Kiwanuka, Tinashe, Bicep, Seun Kuti, Hermanos Gutiérrez and more","RLR 10.2.26 | Walter Bishop Jr., Hiatus Kaiyote, Logic1000, Kaytranada, Tinashe and more"];
export const GOLDEN_TAGS = ["Jazz","Electronic","R&B","Soul","Hip Hop"];
export const GOLDEN_DESCRIPTION = "Rhythm Lab Radio, week of October 2, 2026, hosted by Tarik Moody and produced by Radio Milwaukee.\n\nHour one runs from deep-jazz roots to new soul: Walter Bishop Jr.'s 1973 Black Jazz cut and Hiatus Kaiyote open the set, then it settles into a slow groove with Michael Kiwanuka, Elliott Skinner, Joy Oladokun and Your Old Droog.\n\nHour two starts on the dance floor with Actress, Bicep, Charlotte Adigéry & Bolis Pupul and Logic1000, then strips the electronics away through Tinashe, GENA and Kaytranada. The back half travels from Lagos to Mexico City to the Andes to Addis Ababa with Seun Kuti & Egypt 80, Son Rompe Pera, Hermanos Gutiérrez and Teodros Makonnen.";
export const GOLDEN_TRACKS = [
 {
  "hour": 1,
  "position": 1,
  "artist": "Walter Bishop, Jr.",
  "title": "N'Dugu's Prayer",
  "raw": "Walter Bishop, Jr. - \"N'Dugu's Prayer\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 2,
  "artist": "Hiatus Kaiyote",
  "title": "The World It Softly Lulls",
  "raw": "Hiatus Kaiyote - \"The World It Softly Lulls\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 3,
  "artist": "BADBADNOTGOOD & Samuel T. Herring",
  "title": "Time Moves Slow",
  "raw": "BADBADNOTGOOD & Samuel T. Herring - \"Time Moves Slow\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 4,
  "artist": "Resavoir",
  "title": "4th Cloud",
  "feat": "Gregory Uhlmann",
  "raw": "Resavoir - \"4th Cloud\" feat. Gregory Uhlmann",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 5,
  "artist": "Michael Kiwanuka",
  "title": "Summer Clothes",
  "raw": "Michael Kiwanuka - \"Summer Clothes\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 6,
  "artist": "The Midnight Hour",
  "title": "Water's Edge",
  "raw": "The Midnight Hour - \"Water's Edge\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 7,
  "artist": "Elliott Skinner",
  "title": "Don't Be A Runner",
  "raw": "Elliott Skinner - \"Don't Be A Runner\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 8,
  "artist": "Zoe's Shanghai",
  "title": "Big big picture",
  "raw": "Zoe's Shanghai - \"Big big picture\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 9,
  "artist": "Joy Oladokun",
  "title": "Easy Company",
  "raw": "Joy Oladokun - \"Easy Company\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 10,
  "artist": "Saigon Soul Revival",
  "title": "Lý Qua Dub",
  "raw": "Saigon Soul Revival - \"Ly Qua Dub\"",
  "closing": false,
  "status": "spelling-fixed"
 },
 {
  "hour": 1,
  "position": 11,
  "artist": "The Operator Sound INC.",
  "title": "Appel En Attente (Call Waiting)",
  "raw": "The Operator Sound INC. - \"Appel En Attente (Call Waiting)\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 12,
  "artist": "Thee Sinseers & Joey Quiñones",
  "title": "Let's Fall In Love (Again)",
  "raw": "Thee Sinseers & Joey Quinones - \"Let's Fall In Love (Again)\"",
  "closing": false,
  "status": "spelling-fixed"
 },
 {
  "hour": 1,
  "position": 13,
  "artist": "Liv East",
  "title": "Fever Dream",
  "raw": "Liv East - \"Fever Dream\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 14,
  "artist": "Your Old Droog",
  "title": "I Appreciate You",
  "feat": "Tarriona \"Tank\" Ball",
  "raw": "Your Old Droog - \"I Appreciate You\" feat. Tarriona \"Tank\" Ball",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 1,
  "position": 15,
  "artist": "Channell & 2bfrank",
  "title": "Just Move",
  "raw": "Channell & 2bfrank - \"Just Move\"",
  "closing": true,
  "status": "closing-track"
 },
 {
  "hour": 2,
  "position": 1,
  "artist": "Actress",
  "title": "Withending",
  "raw": "Actress - \"Withending\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 2,
  "artist": "Bicep",
  "title": "Viper",
  "feat": "Clark & Saskia",
  "raw": "Bicep - \"Viper\" feat. Clark & Saskia",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 3,
  "artist": "Charlotte Adigéry & Bolis Pupul",
  "title": "Googoo Gaga",
  "raw": "Charlotte Adigery & Bolis Pupul - \"Googoo Gaga\"",
  "closing": false,
  "status": "spelling-fixed"
 },
 {
  "hour": 2,
  "position": 4,
  "artist": "Logic1000",
  "title": "Sparkle",
  "raw": "Logic1000 - \"Sparkle\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 5,
  "artist": "Tinashe",
  "title": "Twentyfive Eight",
  "raw": "Tinashe - \"Twentyfive Eight\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 6,
  "artist": "ISHA",
  "title": "Feel At Home",
  "raw": "ISHA - \"Feel At Home\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 7,
  "artist": "GENA",
  "title": "Lead It Up (Kaytranada Remix)",
  "raw": "GENA - \"Lead It Up (Kaytranada Remix)\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 8,
  "artist": "Kaytranada",
  "title": "backstABS",
  "raw": "Kaytranada - \"backstABS\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 9,
  "artist": "Tinashe",
  "title": "Sunglasses",
  "raw": "Tinashe - \"Sunglasses\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 10,
  "artist": "Seun Kuti & Egypt 80",
  "title": "Problems",
  "feat": "Kabaka Pyramid",
  "raw": "Seun Kuti & Egypt 80 - \"Problems\" feat. Kabaka Pyramid",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 11,
  "artist": "Son Rompe Pera",
  "title": "Hagan Rueda",
  "raw": "Son Rompe Pera - \"Hagan Rueda\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 12,
  "artist": "Silvan Strauss",
  "title": "All Bosses",
  "raw": "Silvan Strauss - \"All Bosses\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 13,
  "artist": "Hermanos Gutiérrez",
  "title": "Los Ojos Del Cóndor",
  "raw": "Hermanos Gutierrez - \"Los Ojos Del Cndor\"",
  "closing": false,
  "status": "spelling-fixed"
 },
 {
  "hour": 2,
  "position": 14,
  "artist": "ALA.NI & Adrian Younge",
  "title": "Dusty Road",
  "raw": "ALA.NI & Adrian Younge - \"Dusty Road\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 15,
  "artist": "Teodros Makonnen",
  "title": "Libesh Kabashen",
  "raw": "Teodros Makonnen - \"Libesh Kabashen\"",
  "closing": false,
  "status": "confirmed"
 },
 {
  "hour": 2,
  "position": 16,
  "artist": "SW2 vs EL-B",
  "title": "Nightmare On Bascombe Street",
  "raw": "SW2 vs EL-B - \"Nightmare On Bascombe Street\"",
  "closing": true,
  "status": "closing-track"
 }
] as unknown as PackageDraft["tracks"];
