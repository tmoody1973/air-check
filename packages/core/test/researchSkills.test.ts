import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CitedSource, type JudgedClaim, RESEARCH_SKILL_TEXT, showNotesMarkdown } from "../src/index";

const body = (skill: string) =>
  readFileSync(fileURLToPath(new URL(`../../../skills/${skill}/SKILL.md`, import.meta.url)), "utf8")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .trim();

describe("RESEARCH_SKILL_TEXT", () => {
  it("is each research skill's body, without the frontmatter (run `pnpm sync:skills` after editing a skill)", () => {
    expect(RESEARCH_SKILL_TEXT["show-notes"]).toBe(body("rlr-show-notes"));
    expect(RESEARCH_SKILL_TEXT.verify).toBe(body("rlr-pre-air-verify"));
    expect(RESEARCH_SKILL_TEXT["deep-dive"]).toBe(body("rlr-deep-dive"));
    expect(RESEARCH_SKILL_TEXT["show-notes"]).not.toContain("name: rlr-show-notes");
  });

  it("no longer tells the agent to ask about closing tracks or to use Tavily directly", () => {
    for (const text of Object.values(RESEARCH_SKILL_TEXT)) {
      expect(text).not.toMatch(/Tavily|Ask Tarik once/);
      expect(text).toContain("source_search");
    }
    expect(RESEARCH_SKILL_TEXT["show-notes"]).toContain("from your supplied notes, which I did not independently check");
  });
});

describe("rlr-show-notes (Oct 29)", () => {
  const skill = RESEARCH_SKILL_TEXT["show-notes"];

  it("searches the web first with Tarik's query, at most 3 a track, and keeps unsourced facts as [verify]", () => {
    // Oct 29 prefetch: Air Check runs the first search in code; the skill says to read it before searching.
    expect(skill).toContain("Your first search for each track is already done; read it before searching.");
    expect(skill).toContain('`first_search` with the job and the track key. Air Check ran exactly `Tell me about this artist and release <Artist> - "<Title>"`');
    expect(skill).toContain("At most 3 web searches a track");
    expect(skill).toContain('`source: "apple_music"`');
    expect(skill).toContain("submit it with `sources: []`");
    expect(skill).not.toMatch(/No source, no sentence|Say what could not be found|Pre-Air Verify List|Show Thread/);
  });

  it("its Bicep example is exactly what Air Check renders from those claims (public sources only)", () => {
    const src = (host: string, extra: Partial<CitedSource> = {}): CitedSource => ({ url: `https://${host}/${Math.random()}`, host, title: host, via: "tavily", primary: false, matched: true, ...extra });
    const [wiki, yt, insta, ins, earth] = ["en.wikipedia.org", "www.youtube.com", "www.instagram.com", "www.insomniac.com", "earthsonic.org"];
    const c = (kind: JudgedClaim["kind"], text: string, sources: CitedSource[], extra: Partial<JudgedClaim> = {}): JudgedClaim => ({ kind, text, status: "sourced", sources, ...extra });
    const claims = [
      c("release", "\"Glue\" is from Bicep's 2017 debut album, *Bicep*.", [src(wiki!)], { value: "Bicep" }),
      c("label", "It came out on Ninja Tune.", [src(wiki!), src(yt!)], { value: "Ninja Tune", status: "confirmed" }),
      c("release-date", "It was released as a single on 2 November 2017.", [src(wiki!), src(insta!, { says: "2017-08-03" })], { value: "2017-11-02", status: "conflict" }),
      c("chart", "DJ Mag voted it Best of British Track of the Year, and Mixmag placed it second in its 100 Best Tracks of 2017.", [src(wiki!)]),
      c("bio", "Bicep are Matt McBriar and Andy Ferguson, Belfast-born childhood friends who met aged 8 and are now based in London.", [src(ins!)]),
      c("bio", "Their second album, *Isles* (January 2021), debuted at No. 2 on the UK Albums Chart.", [src(earth!)]),
      c("video", "Joe Wilson's video revisits rave-era party sites now left empty (an abandoned lido, a remote airfield, a disused warehouse) under viewers' YouTube-comment memories.", [src(yt!)]),
      c("video", "Fact ranked it third of its ten best videos of 2017.", [src(wiki!)]),
    ];
    const tracks = [
      { key: "H1.1", hour: 1 as const, position: 1, artist: "A", title: "B", closing: false },
      { key: "H1.2", hour: 1 as const, position: 2, artist: "Bicep", title: "Glue", closing: false },
    ];
    const md = showNotesMarkdown({ showDate: "2026-10-30", angles: false, tracks, entries: [{ key: "H1.2", claims }] });
    const entry = (text: string) => {
      const lines = text.slice(text.indexOf('### 2. Bicep, "Glue"')).split("\n").filter(Boolean);
      return lines.slice(0, 1 + lines.slice(1).findIndex((l) => !l.startsWith("- "))).join("\n").replace(/\]\(https:[^)]*\)/g, "](…)");
    };
    expect(entry(skill)).toBe(entry(md));
  });
});
