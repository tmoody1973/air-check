import { describe, expect, test } from "vitest";
import { type AgentPackageInput, buildPackageDraft } from "../src/index";
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
});
