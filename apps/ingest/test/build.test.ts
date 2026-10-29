import { assembleEpisode, type BoxFile } from "@aircheck/core";
import { describe, expect, test } from "vitest";
import { buildEpisodes, type Found } from "../src/build.js";
import type { Correction, IngestRow } from "../src/convex.js";

const wav = (id: string, name: string): BoxFile => ({ id, name, size: 600_000_000 });
const folder = (id: string, name: string, files: BoxFile[]) => ({ id, name, assembly: assembleEpisode(name, files), wavs: files.filter((f) => /\.wav$/i.test(f.name)) });
const doc = (id: string, name: string, h1: string[], h2: string[]) => ({ id, name, text: `HOUR 1\n${h1.join("\n")}\nHOUR 2\n${h2.join("\n")}` });
const H1 = ["A - \"One\"", "B - \"Two\"", "C - \"Three\""];
const H2 = ["D - \"Four\"", "E - \"Five\"", "F - \"Six\""];
const found = (o: Partial<Found> = {}): Found => ({ box: new Map(), drive: new Map(), paper: new Map(), ...o });
const one = (f: Found, stored: IngestRow[] = []) => buildEpisodes(f, stored, new Set());
const fixed = (f: Found, c: Omit<Correction, "showDate" | "updatedAt">, date = "2026-02-06") => buildEpisodes(f, [], new Set(), [{ showDate: date, updatedAt: 1, ...c }]);

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
    const many = Array.from({ length: 30 }, (_, i) => `${"no dash in this long line ".repeat(i === 0 ? 60 : 1)}${i}`);
    const [e] = one(found({ drive: new Map([["2026-02-06", [doc("g", "Rhythm Lab Radio 2-6-26", ["A - \"One\"", ...many], H2)]]]) }));
    expect(e!.questions).toHaveLength(20);
    expect(e!.questions.every((q) => q.text.length <= 1000)).toBe(true);
    expect(e!.questions[19]!.text).toMatch(/^…and \d+ more problems with the docs for 2026-02-06/);
    expect(new Set(e!.questions.map((q) => q.id)).size).toBe(20);
  });

  test("M6: questions only a fix in the source settles (duplicates, an unreadable or one-hour tracklist) are actions; others are not", () => {
    const paper = (id: string) => ({ id, name: `Rhythm Lab Radio 2-6-26 ${id}.paper`, export: { kind: "ok" as const, text: "" } });
    const [dupes] = one(found({
      box: new Map([["2026-02-06", [folder("1", "2-6-26", [wav("a", "9125.wav"), wav("b", "9126.wav")]), folder("2", "2-06-26", [wav("c", "9125.wav"), wav("d", "9126.wav")])]]]),
      drive: new Map([["2026-02-06", [doc("g1", "Rhythm Lab Radio 2-6-26", H1, H2), doc("g2", "Rhythm Lab Radio 2-6-26 (copy)", H1, H2)]]]),
      paper: new Map([["2026-02-06", [paper("p1"), paper("p2")]]]),
    }));
    expect(dupes!.questions.map((q) => q.action)).toEqual([true, true, true]);
    const [broken] = one(found({ drive: new Map([["2026-02-13", [doc("g", "Rhythm Lab Radio 2-13-26", ["A - \"One\"", "no dash here at all"], [])]]]) }));
    expect(broken!.questions.length).toBeGreaterThan(0);
    expect(broken!.questions.every((q) => q.action === true)).toBe(true);
    const [stamped] = one(found({ box: new Map([["2026-02-06", [folder("1", "2-6-26", [wav("a", "9125_013026.wav"), wav("b", "9126_013026.wav")])]]]) }));
    expect(stamped!.questions.length).toBeGreaterThan(0);
    expect(stamped!.questions.some((q) => q.action)).toBe(false);
  });

  test("Drive decides (Tarik, Oct 28): notes that differ from the tracklist raise no questions; Drive's order and count stand; Paper only fixes spelling", () => {
    const notes = { kind: "ok" as const, text: "# Hour 1\n## 1. Ä – \"Öne\"\nSome words about artist C.\n# Hour 2\n## 1. Nobody – \"Else\"" };
    const [e] = one(found({ drive: new Map([["2026-02-20", [doc("g", "Rhythm Lab Radio 2-20-26", H1, H2)]]]), paper: new Map([["2026-02-20", [{ id: "p", name: "n.paper", export: notes }]]]) }));
    expect(e!.questions).toEqual([]);
    const tracks = e!.tracklist.status === "found" ? e!.tracklist.tracks! : [];
    expect(tracks.map((t) => [t.hour, t.artist, t.title, t.status])).toEqual([
      [1, "Ä", "Öne", "spelling-fixed"], [1, "B", "Two", "unverified-in-notes"], [1, "C", "Three", "closing-track"],
      [2, "D", "Four", "unverified-in-notes"], [2, "E", "Five", "unverified-in-notes"], [2, "F", "Six", "closing-track"],
    ]);
    const [broken] = one(found({ drive: new Map([["2026-02-27", [doc("g", "Rhythm Lab Radio 2-27-26", ["A - \"One\"", "no dash here at all"], H2)]]]), paper: new Map([["2026-02-27", [{ id: "p", name: "n.paper", export: notes }]]]) }));
    expect(broken!.questions.map((q) => q.text)).toEqual([expect.stringMatching(/^Line \d+ "no dash here at all" could not be read/)]);
  });

  test("notes over 64 KB are not sent; a question says why", () => {
    const [e] = one(found({ paper: new Map([["2026-02-06", [{ id: "p", name: "n.paper", export: { kind: "ok", text: "x".repeat(70_000) } }]]]) }));
    expect(e!.notes).toEqual({ status: "found", docId: "p" });
    expect(e!.questions[0]!.text).toMatch(/over 64 KB/);
  });

  test("a Paper doc about the artists with no track lines raises no question; its text still goes to the draft (R2)", () => {
    const [e] = one(found({ paper: new Map([["2026-02-06", [{ id: "p", name: "n.paper", export: { kind: "ok", text: "Just prose about the show." } }]]]) }));
    expect(e!.notes).toEqual({ status: "found", docId: "p", text: "Just prose about the show." });
    expect(e!.questions).toEqual([]);
  });
});

describe("corrections (Plan 6b)", () => {
  const D = "2026-02-06";
  const paper = (id: string, text = "") => ({ id, name: `Rhythm Lab Radio 2-6-26 ${id}.paper`, export: { kind: "ok" as const, text } });
  const twoDrive = () => found({ drive: new Map([[D, [doc("g1", "Rhythm Lab Radio 2-6-26", H1, H2), doc("g2", "Rhythm Lab Radio 2-6-26 (copy)", ["X - \"Ex\""], ["Y - \"Why\""])]]]) });
  const twoBox = () => found({ box: new Map([[D, [folder("f1", "2-6-26", [wav("a", "9125.wav"), wav("b", "9126.wav")]), folder("f2", "2-06-26", [wav("c", "9125.wav"), wav("d", "9126.wav")])]]]) });
  const special = () => found({ box: new Map([[D, [folder("f1", "RECAP 2-6-26", [wav("w1", "hour one.wav"), wav("w2", "hour two.wav"), { id: "t", name: "notes.txt", size: 1 }])]]]) });
  const stamped = () => found({ box: new Map([[D, [folder("f1", "2-6-26", [wav("a", "9125_013026.wav"), wav("b", "9126_013026.wav")])]]]) });
  const trackRows = (e: { tracklist: { tracks?: { artist: string; title: string; status: string }[] } }) => e.tracklist.tracks!.map((t) => [t.artist, t.title, t.status]);

  describe("fix choices on questions", () => {
    test("two Drive docs → pick between them", () => {
      const [e] = one(twoDrive());
      expect(e!.questions[0]!.fix).toEqual({ type: "pick", source: "drive", choices: [{ id: "g1", name: "Rhythm Lab Radio 2-6-26" }, { id: "g2", name: "Rhythm Lab Radio 2-6-26 (copy)" }] });
    });

    test("two Paper docs → pick between them", () => {
      const [e] = one(found({ paper: new Map([[D, [paper("p1"), paper("p2")]]]) }));
      expect(e!.questions[0]!.fix).toEqual({ type: "pick", source: "paper", choices: [{ id: "p1", name: "Rhythm Lab Radio 2-6-26 p1.paper" }, { id: "p2", name: "Rhythm Lab Radio 2-6-26 p2.paper" }] });
    });

    test("two Box folders → pick between them", () => {
      const [e] = one(twoBox());
      expect(e!.questions[0]!.fix).toEqual({ type: "pick", source: "box", choices: [{ id: "f1", name: "2-6-26" }, { id: "f2", name: "2-06-26" }] });
    });

    test("a special folder → choose its two hours from its WAVs (at most 20)", () => {
      const [e] = one(special());
      expect(e!.questions[0]!.fix).toEqual({ type: "hours", choices: [{ id: "w1", name: "hour one.wav" }, { id: "w2", name: "hour two.wav" }] });
      const many = Array.from({ length: 25 }, (_, i) => wav(`w${i}`, `take ${i}.wav`));
      const [big] = one(found({ box: new Map([[D, [folder("f1", "Best of 2-6-26", many)]]]) }));
      expect(big!.questions[0]!.fix).toMatchObject({ type: "hours", choices: expect.any(Array) });
      expect((big!.questions[0]!.fix as { choices: unknown[] }).choices).toHaveLength(20);
    });

    test("a date mismatch → confirm the folder's date over the stamp", () => {
      const [e] = one(stamped());
      expect(e!.questions.find((q) => q.kind === "date")!.fix).toEqual({ type: "stamp", folderDate: D, stampDate: "2026-01-30" });
      expect(e!.questions.find((q) => q.kind === "rerun")!.fix).toBeUndefined();
    });

    test("an unreadable line, a missing hour, too many tracks → fix the tracklist", () => {
      const [bad] = one(found({ drive: new Map([[D, [doc("g", "Rhythm Lab Radio 2-6-26", ["A - \"One\"", "no dash here at all"], [])]]]) }));
      expect(bad!.questions.map((q) => q.fix)).toEqual([{ type: "tracklist" }, { type: "tracklist" }]);
      const lots = Array.from({ length: 101 }, (_, i) => `A${i} - "T${i}"`);
      const [big] = one(found({ drive: new Map([[D, [doc("g", "Rhythm Lab Radio 2-6-26", lots, H2)]]]) }));
      expect(big!.questions.map((q) => [q.text.match(/more than a show can hold/) !== null, q.fix])).toEqual([[true, { type: "tracklist" }]]);
    });
    test("R2: a Drive doc that could not be read → fix the tracklist; a typed tracklist settles it", () => {
      const unread = () => found({ drive: new Map([[D, [{ id: "g", name: "Rhythm Lab Radio 2-6-26", text: null }]]]) });
      const [e] = one(unread());
      expect(e!.questions.map((q) => [/could not be read from Drive/.test(q.text), q.fix])).toEqual([[true, { type: "tracklist" }]]);
      const [typed] = fixed(unread(), { tracklistText: "HOUR 1\nA - \"One\"\nHOUR 2\nB - \"Two\"" });
      expect(typed!.questions).toEqual([]);
      expect(typed!.tracklist).toMatchObject({ status: "found", docId: "air-check" });
    });
  });

  describe("picks apply", () => {
    test("{ drive: g2 } → the tracklist comes from g2 and no duplicate question", () => {
      const [e] = fixed(twoDrive(), { drive: "g2" });
      expect(e!.tracklist).toMatchObject({ status: "found", docId: "g2" });
      expect(trackRows(e!)).toEqual([["X", "Ex", "closing-track"], ["Y", "Why", "closing-track"]]);
      expect(e!.questions).toEqual([]);
      expect(e!.correctionStale).toBeUndefined();
    });

    test("{ paper: p2 } → the notes come from p2", () => {
      const [e] = fixed(found({ paper: new Map([[D, [paper("p1", "one"), paper("p2", "two")]]]) }), { paper: "p2" });
      expect(e!.notes).toEqual({ status: "found", docId: "p2", text: "two" });
      expect(e!.questions).toEqual([]);
    });

    test("{ box: f2 } → the audio comes from folder f2", () => {
      const [e] = fixed(twoBox(), { box: "f2" });
      expect(e!.audio).toMatchObject({ status: "ready", folderId: "f2", hour1: { id: "c" }, hour2: { id: "d" } });
      expect(e!.questions).toEqual([]);
    });
  });

  describe("the typed tracklist", () => {
    const typed = "HOUR 1\nA - \"One\"\nHOUR 2\nB - \"Two\"";

    test("used as typed: both closing tracks, docId air-check, no tracklist questions even with a broken or duplicate Drive doc", () => {
      for (const f of [twoDrive(), found({ drive: new Map([[D, [doc("g", "Rhythm Lab Radio 2-6-26", ["no dash here at all"], [])]]]) })]) {
        const [e] = fixed(f, { tracklistText: typed });
        expect(e!.tracklist).toMatchObject({ status: "found", docId: "air-check" });
        expect(trackRows(e!)).toEqual([["A", "One", "closing-track"], ["B", "Two", "closing-track"]]);
        expect(e!.questions).toEqual([]);
      }
    });

    test("Paper's spelling never applies to it", () => {
      const notes = { kind: "ok" as const, text: "# Hour 1\n## 1. Á – \"Óne\"\n# Hour 2\n## 1. B – \"Two\"" };
      const [e] = fixed(found({ paper: new Map([[D, [{ id: "p", name: "n.paper", export: notes }]]]) }), { tracklistText: typed });
      expect(trackRows(e!)).toEqual([["A", "One", "closing-track"], ["B", "Two", "closing-track"]]);
      expect(e!.notes).toMatchObject({ status: "found", docId: "p" });
    });
  });

  describe("hours and stamp", () => {
    test("{ hours } on a special folder → ready with the chosen files, pattern picked, no audio question", () => {
      const [e] = fixed(special(), { hours: { hour1: "w2", hour2: "w1" } });
      expect(e!.audio).toEqual({
        status: "ready", folderId: "f1", pattern: "picked", flags: [],
        hour1: { id: "w2", name: "hour two.wav", size: 600_000_000 }, hour2: { id: "w1", name: "hour one.wav", size: 600_000_000 },
      });
      expect(e!.questions).toEqual([]);
    });

    test("{ folderDate } on a date mismatch → ready, no date question; the stamp's rerun hint is still asked", () => {
      const [e] = fixed(stamped(), { folderDate: true });
      expect(e!.audio).toMatchObject({ status: "ready", folderId: "f1", hour1: { id: "a" }, hour2: { id: "b" } });
      expect(e!.questions.map((q) => [q.kind, q.rerunOf])).toEqual([["rerun", "2026-01-30"]]);
    });

    test("M4: { folderDate } once the stamps are fixed (no mismatch) is ignored silently: not stale, audio as assembled", () => {
      const ok = found({ box: new Map([[D, [folder("f1", "2-6-26", [wav("a", "9125.wav"), wav("b", "9126.wav")])]]]) });
      const [e] = fixed(ok, { folderDate: true });
      const [plain] = one(ok);
      expect(e!.audio).toEqual(plain!.audio);
      expect(e!.correctionStale).toBeUndefined();
    });
  });

  describe("stale corrections (Review Focus 1)", () => {
    test("{ drive: gone } with g1/g2 → the duplicate question is back and the correction is stale", () => {
      const [e] = fixed(twoDrive(), { drive: "gone" });
      expect(e!.questions[0]!.text).toMatch(/Drive has 2 tracklists/);
      expect(e!.correctionStale).toBe(true);
    });

    test("{ hours } naming a file that is gone → the special-folder question is back and the correction is stale", () => {
      const [e] = fixed(special(), { hours: { hour1: "w9", hour2: "w1" } });
      expect(e!.audio.status).toBe("ask");
      expect(e!.questions.map((q) => q.fix?.type)).toEqual(["hours"]);
      expect(e!.correctionStale).toBe(true);
    });

    test("a correction for another date changes nothing", () => {
      const [e] = fixed(twoDrive(), { drive: "g2" }, "2026-02-13");
      expect(e!.questions[0]!.text).toMatch(/Drive has 2 tracklists/);
      expect(e!.correctionStale).toBeUndefined();
    });
  });

  describe("the Drive text is kept for the editor", () => {
    test("the chosen doc's text, capped at 20,000 characters; none with two docs and no pick", () => {
      const [picked] = fixed(twoDrive(), { drive: "g1" });
      expect(picked!.tracklist.text).toBe(doc("g1", "", H1, H2).text);
      const long = { id: "g", name: "Rhythm Lab Radio 2-6-26", text: `${doc("g", "", H1, H2).text}\n${"x".repeat(30_000)}` };
      const [capped] = one(found({ drive: new Map([[D, [long]]]) }));
      expect(capped!.tracklist.text).toHaveLength(20_000);
      const [none] = one(twoDrive());
      expect(none!.tracklist.text).toBeUndefined();
    });
  });
});
