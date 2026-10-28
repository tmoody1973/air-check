import { describe, expect, test } from "vitest";
import { type AgentPackageInput, buildPackageDraft, checkDescriptionChange } from "../src/index";
import { goldenDescription, goldenPackageTitles, leadsOf, readFixture } from "./helpers/fixtures";
import { formatTrack } from "../src/index";
import { goldenDraft, goldenTitles, goldenTracks } from "./helpers/goldens";

const input = (over: Partial<AgentPackageInput> = {}): AgentPackageInput => ({
  showDate: "2026-10-02",
  tracklistText: readFixture("raw/10-2-26-drive-tracklist.txt"),
  leads: leadsOf(goldenPackageTitles()[0]!),
  tags: goldenDraft().tags,
  description: goldenDescription(),
  hour1Id: "box-h1",
  hour2Id: "box-h2",
  ...over,
});
const reconciledText = () =>
  [1, 2]
    .map((h) => [`HOUR ${h}`, ...goldenTracks().filter((t) => t.hour === h).map(formatTrack)].join("\n"))
    .join("\n");
const opts = { privateTerms: [] as string[] };

describe("buildPackageDraft", () => {
  test("builds the 10-2-26 golden package", () => {
    const r = buildPackageDraft(input({ tracklistText: reconciledText() }), opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.draft;
    expect(d.tracks).toHaveLength(31);
    expect(d.tracks.filter((t) => t.hour === 1)).toHaveLength(15);
    expect(d.tracks.filter((t) => t.hour === 2)).toHaveLength(16);
    expect(d.tracks.filter((t) => t.closing).map((t) => [t.hour, t.position])).toEqual([[1, 15], [2, 16]]);
    expect(d.tracks.map((t) => t.title)).toEqual(goldenTitles());
    expect(d.title).toBe(goldenPackageTitles()[0]);
    expect(d.id).toBe("pkg-10-2-26");
    expect(d.workspace).toBe("real");
    expect(d.audio).toEqual({ hour1Id: "box-h1", hour2Id: "box-h2" });
  });

  test("a demo-workspace draft gets a demo- id so it can never collide with a real pkg- id", () => {
    const r = buildPackageDraft(input({ tracklistText: reconciledText() }), { ...opts, workspace: "demo" });
    expect(r.ok && [r.draft.id, r.draft.workspace]).toEqual(["demo-10-2-26", "demo"]);
  });

  test("idSuffix makes a demo id unique per draft; a real id ignores it", () => {
    const demo = buildPackageDraft(input({ tracklistText: reconciledText() }), { ...opts, workspace: "demo", idSuffix: "a1b2c" });
    expect(demo.ok && demo.draft.id).toBe("demo-10-2-26-a1b2c");
    const real = buildPackageDraft(input({ tracklistText: reconciledText() }), { ...opts, idSuffix: "a1b2c" });
    expect(real.ok && real.draft.id).toBe("pkg-10-2-26");
  });

  test("raw Drive text parses without bad lines", () => {
    const r = buildPackageDraft(input(), opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.tracks).toHaveLength(31);
  });

  test("never emits start times", () => {
    const r = buildPackageDraft(input(), opts);
    expect(JSON.stringify(r)).not.toMatch(/start_?time/i);
  });

  test("rejects a description over 1,000 characters", () => {
    const r = buildPackageDraft(input({ description: goldenDescription() + " x".repeat(600) }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("\n")).toContain("1,000");
  });

  test('rejects "out today" in the description', () => {
    const r = buildPackageDraft(input({ description: `${goldenDescription()} Out today.` }), opts);
    expect(r.ok).toBe(false);
  });

  test("rejects a lead artist not in the tracklist", () => {
    const leads = [...input().leads.slice(0, 3), "Nobody At All"];
    expect(buildPackageDraft(input({ leads }), opts).ok).toBe(false);
  });

  test("rejects a tracklist with a bad line", () => {
    const text = `${readFixture("raw/10-2-26-drive-tracklist.txt")}\nthis line has no separator`;
    const r = buildPackageDraft(input({ tracklistText: text }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("\n")).toContain("this line has no separator");
  });

  test("rejects empty hour ids", () => {
    expect(buildPackageDraft(input({ hour1Id: "" }), opts).ok).toBe(false);
    expect(buildPackageDraft(input({ hour2Id: "  " }), opts).ok).toBe(false);
  });

  test("rejects a tracklist with no hour-2 tracks", () => {
    const hour1Only = reconciledText().split("HOUR 2")[0]!;
    const r = buildPackageDraft(input({ tracklistText: hour1Only }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain("hour 2 has no tracks");
  });

  test("rejects a blank lead artist", () => {
    const leads = [...input().leads];
    leads[1] = " ";
    const r = buildPackageDraft(input({ leads }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain("title artist 2 is blank");
  });

  test("rejects a calendar date that does not exist", () => {
    const r = buildPackageDraft(input({ showDate: "2026-02-30" }), opts);
    expect(r).toEqual({ ok: false, problems: ["showDate is not a real date: 2026-02-30"] });
    expect(buildPackageDraft(input({ showDate: "2026-13-01" }), opts).ok).toBe(false);
  });

  describe("descriptionSources", () => {
    const good = { claim: "Antibalas is a Brooklyn Afrobeat band", source: "MusicBrainz: Antibalas" };
    const build = (descriptionSources: unknown) =>
      buildPackageDraft(input({ tracklistText: reconciledText(), descriptionSources: descriptionSources as AgentPackageInput["descriptionSources"] }), opts);

    test("accepted sources land on the draft", () => {
      const r = build([good]);
      expect(r.ok && r.draft.descriptionSources).toEqual([good]);
    });
    test("absent means no key on the draft", () => {
      const r = buildPackageDraft(input({ tracklistText: reconciledText() }), opts);
      expect(r.ok && "descriptionSources" in r.draft).toBe(false);
    });
    test.each([
      ["empty claim", [{ ...good, claim: " " }]],
      ["empty source", [{ ...good, source: "" }]],
      ["claim over 300", [{ ...good, claim: "x".repeat(301) }]],
      ["source over 300", [{ ...good, source: "x".repeat(301) }]],
      ["13 entries", Array.from({ length: 13 }, () => good)],
      ["not an array", "nope"],
      ["wrong entry shape", [{ claim: 1, source: 2 }]],
    ])("rejects %s with a plain message", (_n, v) => {
      const r = build(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.some((p) => p.startsWith("descriptionSources"))).toBe(true);
    });
    test("12 entries of exactly 300 characters are fine", () => {
      const max = { claim: "c".repeat(300), source: "s".repeat(300) };
      expect(build(Array.from({ length: 12 }, () => max)).ok).toBe(true);
    });
  });
});

// Final-review fix: a blank description is a problem on every path: submit (buildPackageDraft) and the edit, revise and
// propose paths (all through checkDescriptionChange).
describe("an empty description", () => {
  test.each(["", "   ", "\n\t "])("submit refuses %j", (description) => {
    const r = buildPackageDraft(input({ tracklistText: reconciledText(), description }), opts);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toContain("description is empty");
  });
  test.each(["", "   ", "\n\t "])("edit, revise and propose refuse %j", (description) => {
    expect(checkDescriptionChange(goldenDraft(), description, undefined, [])).toContain("description is empty");
  });
  test("a real description passes", () => {
    expect(checkDescriptionChange(goldenDraft(), "Warm, patient soul.", undefined, [])).toEqual([]);
  });
});
