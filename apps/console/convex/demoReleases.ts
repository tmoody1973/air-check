// Oct 30 (decision 026): real, already-released albums and singles from the station's radar that have Bandcamp's own
// player, shown in the judges' demo so the radar looks and plays like the real one. Public fields only: no senders,
// emails, links, notes or reasons, nothing embargoed. Exported with ~/demo-releases.sh, then checked by hand.
export type DemoRelease = {
  artist: string;
  title: string;
  label?: string;
  type?: "album" | "ep" | "single";
  genre?: string;
  releasedOn?: string;
  bandcampPage: string;
  embed: { kind: "album" | "track"; id: string };
  art?: string;
  tags?: string[];
  source?: "bandcamp" | "cosign";
};

export const DEMO_RELEASES: readonly DemoRelease[] = [
  {
    "artist": "Adrian Younge, Ali Shaheed Muhammad",
    "title": "The Midnight Hour: Lost Tapes JID028",
    "label": "Jazz Is Dead",
    "releasedOn": "2026-10-23",
    "source": "bandcamp",
    "bandcampPage": "https://jazzisdead.bandcamp.com/album/the-midnight-hour-lost-tapes-jid028-2",
    "embed": {
      "kind": "album",
      "id": "69277893"
    },
    "art": "https://f4.bcbits.com/img/a0853286003_5.jpg",
    "tags": [
      "los angeles"
    ]
  },
  {
    "artist": "Finn Rees",
    "title": "Feel The Sun",
    "label": "MR BONGO",
    "releasedOn": "2026-10-30",
    "source": "bandcamp",
    "bandcampPage": "https://finnrees.bandcamp.com/album/feel-the-sun",
    "embed": {
      "kind": "album",
      "id": "2622405906"
    },
    "art": "https://f4.bcbits.com/img/a1009838628_5.jpg",
    "tags": [
      "broken beat",
      "jazz",
      "jazz fusion",
      "cinematic",
      "spiritual jazz"
    ]
  },
  {
    "artist": "Family Tree",
    "title": "Family Tree (12\")",
    "label": "Acid Jazz Records",
    "releasedOn": "2026-10-30",
    "source": "bandcamp",
    "bandcampPage": "https://acidjazz.bandcamp.com/album/family-tree-12",
    "embed": {
      "kind": "album",
      "id": "3884411059"
    },
    "art": "https://f4.bcbits.com/img/a3592083840_5.jpg",
    "tags": [
      "united kingdom"
    ]
  },
  {
    "artist": "Roots Records",
    "title": "Peace & Love / Adapter Chapter",
    "label": "Acid Jazz Records",
    "releasedOn": "2026-10-29",
    "source": "bandcamp",
    "bandcampPage": "https://rootsrecordslondon.bandcamp.com/album/peace-love-adapter-chapter",
    "embed": {
      "kind": "album",
      "id": "1232631337"
    },
    "art": "https://f4.bcbits.com/img/a1697375781_5.jpg",
    "tags": [
      "dub",
      "reggae",
      "dancehall",
      "roots",
      "ska"
    ]
  },
  {
    "artist": "Sam Akpro",
    "title": "Gauzy",
    "label": "Anti- Records",
    "releasedOn": "2026-10-30",
    "source": "bandcamp",
    "bandcampPage": "https://samakpro.bandcamp.com/album/gauzy",
    "embed": {
      "kind": "album",
      "id": "3895696336"
    },
    "art": "https://f4.bcbits.com/img/a2047843738_5.jpg",
    "tags": [
      "alternative",
      "trip hop",
      "black-music",
      "london"
    ]
  },
  {
    "artist": "El Michels Affair feat. Ahemaa Nwomkro",
    "title": "Oh Medaase!",
    "releasedOn": "2026-10-28",
    "source": "bandcamp",
    "bandcampPage": "https://elmichelsaffair.bandcamp.com/track/oh-medaase",
    "embed": {
      "kind": "track",
      "id": "872803177"
    },
    "art": "https://f4.bcbits.com/img/a2523716354_5.jpg",
    "tags": [
      "funk",
      "hip hop",
      "r&b/soul",
      "soul",
      "new york"
    ]
  },
  {
    "artist": "Quantic",
    "title": "Subterráneo (Axel Boman Remix)",
    "releasedOn": "2026-10-28",
    "source": "bandcamp",
    "bandcampPage": "https://quanticmusic.bandcamp.com/track/subterr-neo-axel-boman-remix",
    "embed": {
      "kind": "track",
      "id": "1838226381"
    },
    "art": "https://f4.bcbits.com/img/a3989740304_5.jpg",
    "tags": [
      "electronic",
      "funk",
      "soul",
      "cumbia",
      "jazz"
    ]
  },
  {
    "artist": "Lyric Jones & Ian Wallace",
    "title": "Way Too Long",
    "releasedOn": "2026-10-29",
    "source": "bandcamp",
    "bandcampPage": "https://lyricjones.bandcamp.com/album/way-too-long",
    "embed": {
      "kind": "album",
      "id": "766418503"
    },
    "art": "https://f4.bcbits.com/img/a1430585692_5.jpg",
    "tags": [
      "dance",
      "electronic",
      "r&b",
      "r&b and neo-soul",
      "soulful house music"
    ]
  },
  {
    "artist": "Jazir",
    "title": "Like This",
    "label": "Cascade Records",
    "releasedOn": "2026-10-28",
    "source": "bandcamp",
    "bandcampPage": "https://cascaderecords.bandcamp.com/album/like-this",
    "embed": {
      "kind": "album",
      "id": "1419393360"
    },
    "art": "https://f4.bcbits.com/img/a3054298012_5.jpg",
    "tags": [
      "deep house",
      "electronic",
      "house",
      "beats",
      "dance"
    ]
  },
  {
    "artist": "London Elektricity, Stanley Colman",
    "title": "Water No Get Enemy",
    "releasedOn": "2026-10-27",
    "source": "bandcamp",
    "bandcampPage": "https://londonelek.bandcamp.com/track/water-no-get-enemy",
    "embed": {
      "kind": "track",
      "id": "3159601141"
    },
    "art": "https://f4.bcbits.com/img/a4208146932_5.jpg",
    "tags": [
      "afrobeat",
      "electronic",
      "drum & bass",
      "jungle",
      "london"
    ]
  },
  {
    "artist": "Amber Navran",
    "title": "Happy Place Beat Tape",
    "releasedOn": "2026-10-30",
    "source": "bandcamp",
    "bandcampPage": "https://ambernavran.bandcamp.com/album/happy-place-beat-tape",
    "embed": {
      "kind": "album",
      "id": "811452648"
    },
    "art": "https://f4.bcbits.com/img/a1027861878_5.jpg",
    "tags": [
      "electronic",
      "instrumental hip-hop",
      "jazz",
      "neo-soul",
      "r&b"
    ]
  },
  {
    "artist": "Percy & Penderhughes",
    "title": "Bleedin'",
    "label": "Mango Hill Records",
    "releasedOn": "2026-10-29",
    "source": "bandcamp",
    "bandcampPage": "https://mangohillrecords.bandcamp.com/track/bleedin",
    "embed": {
      "kind": "track",
      "id": "1263429565"
    },
    "art": "https://f4.bcbits.com/img/a4238021237_5.jpg",
    "tags": [
      "boogie",
      "boston",
      "funk",
      "r&b/soul",
      "toronto"
    ]
  }
];
