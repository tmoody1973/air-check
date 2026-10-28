import { assembleEpisode, type BoxFile } from "@aircheck/core";
import { describe, expect, test } from "vitest";
import { buildEpisodes, type Found } from "../src/build.js";
import type { IngestRow } from "../src/convex.js";

const wav = (id: string, name: string): BoxFile => ({ id, name, size: 600_000_000 });
const folder = (id: string, name: string, files: BoxFile[]) => ({ id, name, assembly: assembleEpisode(name, files) });
const doc = (id: string, name: string, h1: string[], h2: string[]) => ({ id, name, text: `HOUR 1\n${h1.join("\n")}\nHOUR 2\n${h2.join("\n")}` });
const H1 = ["A - \"One\"", "B - \"Two\"", "C - \"Three\""];
const H2 = ["D - \"Four\"", "E - \"Five\"", "F - \"Six\""];
const found = (o: Partial<Found> = {}): Found => ({ box: new Map(), drive: new Map(), paper: new Map(), ...o });
const one = (f: Found, stored: IngestRow[] = []) => buildEpisodes(f, stored, new Set());

describe("buildEpisodes: questions instead of guesses", () => {
  test("two Box folders for one date → an audio question, no files picked", () => {
    const [e] = one(found({ box: new Map([["2026-02-06", [folder("1", "2-6-26", [wav("a", "9125.wav"), wav("b", "9126.wav")]), folder("2", "2-06-26", [wav("c", "9125.wav"), wav("d", "9126.wav")])]]]) }));
    expect(e!.audio).toEqual({ status: "ask", flags: ["more than one Box folder for this date"] });
    expect(e!.questions.map((q) => q.kind)).toEqual(["audio"]);
  });

  test("hour files stamped with another date → a date question (and a rerun question when the stamp is older)", () => {
    const [e] = one(found({ box: new Map([["2026-02-06", [folder("1", "2-6-26", [wav("a", "9125_013026.wav"), wav("b", "9126_013026.wav")])]]]) }));
    expect(e!.audio.status).toBe("ask");
    expect(e!.questions.map((q) => [q.kind, q.rerunOf])).toEqual([["date", undefined], ["rerun", "2026-01-30"]]);
  });

  test("two Drive docs that both have HOUR 1 / HOUR 2 → a question, no tracklist used", () => {
    const [e] = one(found({ drive: new Map([["2026-02-06", [doc("g1", "Rhythm Lab Radio 2-6-26", H1, H2), doc("g2", "Rhythm Lab Radio 2-6-26 (copy)", H1, H2)]]]) }));
    expect(e!.tracklist).toEqual({ status: "missing" });
    expect(e!.questions[0]!.text).toMatch(/Drive has 2 tracklists for 2026-02-06/);
  });

  test("an older show with ≥ 80% of the same tracks → 'Is <date> a rerun of <date>?'; not asked once marked or declined", () => {
    const f = found({ drive: new Map([["2026-01-02", [doc("g1", "Rhythm Lab Radio 1-2-26", H1, H2)]], ["2026-07-17", [doc("g2", "Rhythm Lab Radio 7-17-26", H1, H2)]]]) });
    const [, jul] = one(f);
    expect(jul!.questions.filter((q) => q.kind === "rerun")).toEqual([{ id: expect.stringMatching(/^rerun-/), kind: "rerun", rerunOf: "2026-01-02", text: "Is 2026-07-17 a rerun of 2026-01-02? 100% of the tracks match the 2026-01-02 show." }]);
    for (const mark of [{ rerunOf: "2026-01-02" }, { rerunDeclined: true as const }]) {
      const [, again] = one(f, [{ showDate: "2026-07-17", ...mark } as IngestRow]);
      expect(again!.questions.filter((q) => q.kind === "rerun")).toEqual([]);
    }
    // R8: "(evergreen)" with no older match asks of which show.
    const [ever] = one(found({ drive: new Map([["2026-08-07", [doc("g3", "Rhythm Lab Radio 8-7-26 (evergreen)", ["X - \"Y\""], ["Z - \"W\""])]]]) }));
    expect(ever!.questions).toEqual([expect.objectContaining({ kind: "rerun", rerunOf: "", text: expect.stringMatching(/^Is 2026-08-07 a rerun, and of which show\?/) })]);
  });

  test("at most 20 questions of at most 1,000 characters (Convex's limits), the 20th summing up the rest", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Artist ${i} - "${"Long title ".repeat(i === 0 ? 120 : 1)}${i}"`);
    const notes = { kind: "ok" as const, text: "# Hour 1\n## 1. Nobody – \"Matches\"\n# Hour 2\n## 1. Still – \"Nothing\"" };
    const [e] = one(found({
      drive: new Map([["2026-02-06", [doc("g", "Rhythm Lab Radio 2-6-26", many, many)]]]),
      paper: new Map([["2026-02-06", [{ id: "p", name: "Rhythm Lab Radio 2-6-26.paper", export: notes }]]]),
    }));
    expect(e!.questions).toHaveLength(20);
    expect(e!.questions.every((q) => q.text.length <= 1000)).toBe(true);
    expect(e!.questions[19]!.text).toMatch(/^…and \d+ more differences/);
    expect(new Set(e!.questions.map((q) => q.id)).size).toBe(20);
  });

  test("notes over 64 KB are not sent; a question says why", () => {
    const [e] = one(found({ paper: new Map([["2026-02-06", [{ id: "p", name: "n.paper", export: { kind: "ok", text: "x".repeat(70_000) } }]]]) }));
    expect(e!.notes).toEqual({ status: "found", docId: "p" });
    expect(e!.questions[0]!.text).toMatch(/over 64 KB/);
  });

  test("a non-empty Paper doc with no track lines is a question, but its text still goes to the draft (R2)", () => {
    const [e] = one(found({ paper: new Map([["2026-02-06", [{ id: "p", name: "n.paper", export: { kind: "ok", text: "Just prose about the show." } }]]]) }));
    expect(e!.notes).toEqual({ status: "found", docId: "p", text: "Just prose about the show." });
    expect(e!.questions[0]!.text).toMatch(/could not be read as a track list/);
  });
});
