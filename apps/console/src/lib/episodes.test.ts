import { describe, expect, it } from "vitest";
import { backlogCount, blankFridays, fetchErrorText, summaryLine } from "./episodes";

describe("blankFridays", () => {
  it("every 2026 Friday up to today with no episode row, oldest first; never a non-Friday, never after today", () => {
    expect(blankFridays(["2026-01-09"], "2026-01-23")).toEqual(["2026-01-02", "2026-01-16", "2026-01-23"]);
    expect(blankFridays([], "2026-01-01")).toEqual([]);
    expect(blankFridays([], "2026-01-08")).toEqual(["2026-01-02"]);
  });

  it("a show dated within the 7 days ending on a Friday covers that Friday (an off-Friday date is not a gap)", () => {
    // Wed Jan 21 covers Fri Jan 23; Sat Jan 10 covers Fri Jan 16 (Jan 10..16), not Jan 9.
    expect(blankFridays(["2026-01-21", "2026-01-10"], "2026-01-23")).toEqual(["2026-01-02", "2026-01-09"]);
  });

  it("a full year has 52 Fridays from Jan 2 to Dec 25 and crosses DST without skipping one", () => {
    const all = blankFridays([], "2026-12-31");
    expect(all).toHaveLength(52);
    expect(all.at(-1)).toBe("2026-12-25");
    expect(all).toContain("2026-03-06");
    expect(all).toContain("2026-03-13");
    expect(all).toContain("2026-11-06");
  });
});

const row = (status: string, gaps: string[] = [], answered: boolean[] = []) => ({
  status, gaps, questions: answered.map((a, i) => ({ id: `q${i}`, ...(a && { answer: "yes" }) })),
});

describe("summaryLine", () => {
  it("counts shows and what is absent from the unfinished ones; zero parts are left out", () => {
    const rows = [
      row("missing-audio", ["audio", "notes"]),
      row("question", ["notes"], [false, true, false]),
      row("ready-to-draft"),
      row("published", ["notes"]),
      row("rerun", ["audio"]),
    ];
    expect(summaryLine(rows, 7)).toBe("4 shows · 1 missing audio · 2 missing notes · 7 blank Fridays · 2 questions · 1 rerun");
    expect(summaryLine([row("ready-to-draft", ["tracklist"])], 1)).toBe("1 show · 1 missing tracklist · 1 blank Friday");
    expect(summaryLine([], 0)).toBe("0 shows");
  });

  it("a source that isn't connected is said once, not counted as missing (the column shows a dash)", () => {
    const rows = [row("ready-to-draft", ["notes"]), row("missing-audio", ["audio", "notes", "tracklist"])];
    expect(summaryLine(rows, 0, ["notes", "tracklist"])).toBe("2 shows · 1 missing audio · tracklists not connected · notes not connected");
  });
});

describe("backlogCount", () => {
  it("shows still to clear: not published, not a rerun, not skipped", () => {
    expect(backlogCount([row("published"), row("rerun"), row("skipped"), row("question"), row("awaiting-review"), row("failed")])).toBe(3);
  });
});

describe("fetchErrorText", () => {
  it("says the ingest service's short codes in plain words and never echoes an unknown one", () => {
    expect(fetchErrorText("too_large")).toBe("the file is bigger than Air Check allows");
    expect(fetchErrorText("size_mismatch")).toBe("the file arrived at the wrong size");
    expect(fetchErrorText("http_404")).toBe("Box couldn't find the file");
    expect(fetchErrorText("http_403")).toBe("Box refused access");
    expect(fetchErrorText("http_503")).toBe("Box had a server problem");
    expect(fetchErrorText("invalid_client")).toBe("the connection dropped or Box refused");
    expect(fetchErrorText(undefined)).toBe("the connection dropped or Box refused");
    expect(fetchErrorText("<script>")).not.toContain("<");
  });
});
