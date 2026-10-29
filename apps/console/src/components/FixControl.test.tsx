// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EpisodeActions, EpisodeRow } from "./EpisodeControls";
import { EpisodesView, type Unplaced } from "./EpisodesView";
import type { SourceStatus } from "./SourceConnections";

// Plan 6b Task 4: fixing a backlog problem on the Episodes page, in the table and in the phone cards.

afterEach(cleanup);

const ep = (showDate: string, over: Partial<EpisodeRow> = {}): EpisodeRow => ({
  showDate, audio: { status: "ready" }, tracklist: { status: "found" }, notes: { status: "found" }, questions: [],
  status: "ready-to-draft", gaps: [], packageId: "pkg-x", packageStatus: "none", draftAttempts: 0, corrected: null, rescanPending: false, ...over,
});
const connected: SourceStatus[] = (["box", "google", "dropbox"] as const).map((source) => ({ source, state: "connected" }));
const noop = async () => undefined;
const actions = (over: Partial<EpisodeActions> = {}): EpisodeActions => ({
  answer: vi.fn(noop), markRerun: vi.fn(noop), unmarkRerun: vi.fn(noop),
  setTracklist: vi.fn(noop), pick: vi.fn(noop), setHours: vi.fn(noop), useFolderDate: vi.fn(noop), clearCorrection: vi.fn(noop),
  place: vi.fn(noop), unplace: vi.fn(noop), tracklistText: vi.fn(async () => "HOUR 1\nDonalyd Byrd - \"Change\"\nHOUR 2\nB - \"Two\""),
  ...over,
});
type Opts = { acts?: EpisodeActions; layout?: "table" | "cards"; unplaced?: Unplaced[] | null; today?: string };
function setup(episodes: EpisodeRow[], { acts = actions(), layout = "table", unplaced = null, today = "2026-01-09" }: Opts = {}) {
  const view = (rows: EpisodeRow[], u: Unplaced[] | null) => (
    <EpisodesView layout={layout} data={{ episodes: rows, awaitingReview: 0 }} unplaced={u} sources={connected} workspace="real" today={today} actions={acts} />
  );
  const r = render(view(episodes, unplaced));
  return { acts, rerender: (rows: EpisodeRow[], u: Unplaced[] | null = unplaced) => r.rerender(view(rows, u)) };
}
const rowOf = (date: string) => document.getElementById(`ep-${date}`)!;
const click = (el: HTMLElement) => act(async () => fireEvent.click(el));
const CHECKING = "Saved. Checking again in a minute or two.";

const boxPick = { id: "pick", kind: "audio" as const, action: true as const, text: 'Box has 2 folders dated 2026-01-09 ("1-9-26", "1-9-26 copy"). Remove or rename the extra folder in Box; until then its audio is not used automatically.',
  fix: { type: "pick" as const, source: "box" as const, choices: [{ id: "f1", name: "1-9-26" }, { id: "f2", name: "1-9-26 copy" }] } };
const hours = { id: "hours", kind: "audio" as const, text: 'The Box folder "RECAP 1-9-26" is a special folder (RECAP, Best of or an unusual name), so its audio is not used automatically. If 2026-01-09 should be posted, copy its two hour WAVs into the inbox by hand.',
  fix: { type: "hours" as const, choices: [{ id: "w1", name: "9125.wav" }, { id: "w2", name: "9126.wav" }, { id: "w3", name: "extra.wav" }] } };
const stamp = { id: "stamp", kind: "date" as const, text: "The Box folder for 2026-01-09 holds hour files stamped 2026-01-02. Which date is this show?",
  fix: { type: "stamp" as const, folderDate: "2026-01-09", stampDate: "2026-01-02" } };
const badLine = { id: "l4", kind: "tracklist" as const, action: true as const, text: 'Line 4 "Donalyd Byrd Change" could not be read (no-separator). Fix it so no track is missed.', fix: { type: "tracklist" as const } };

describe("fix controls under each question", () => {
  it("pick: 'Use this one' beside each choice's name calls pick, and the action question keeps its line", async () => {
    const { acts } = setup([ep("2026-01-09", { status: "question", audio: { status: "ask" }, questions: [boxPick] })]);
    const r = rowOf("2026-01-09");
    expect(r).toHaveTextContent("This clears on the next scan after you fix it.");
    const second = within(r).getByText("1-9-26 copy").closest("li")!;
    await click(within(second).getByRole("button", { name: "Use this one" }));
    expect(acts.pick).toHaveBeenCalledWith({ showDate: "2026-01-09", source: "box", id: "f2" });
    expect(screen.getByRole("status")).toHaveTextContent(CHECKING);
    expect(within(r).getAllByRole("button", { name: "Use this one" })).toHaveLength(2);
  });

  it("hours: Hour 1 and Hour 2 selects; Save waits for two different files, then calls setHours", async () => {
    const { acts } = setup([ep("2026-01-09", { status: "question", audio: { status: "ask" }, questions: [hours] })]);
    const r = rowOf("2026-01-09");
    const save = within(r).getByRole("button", { name: "Save hours" });
    expect(save).toBeDisabled();
    fireEvent.change(within(r).getByLabelText("Hour 1"), { target: { value: "w1" } });
    fireEvent.change(within(r).getByLabelText("Hour 2"), { target: { value: "w1" } });
    expect(save).toBeDisabled();
    fireEvent.change(within(r).getByLabelText("Hour 2"), { target: { value: "w2" } });
    expect(save).toBeEnabled();
    await click(save);
    expect(acts.setHours).toHaveBeenCalledWith({ showDate: "2026-01-09", hour1: "w1", hour2: "w2" });
  });

  it("hand copy: an hours fix replaces the copy-by-hand wording (row note and question)", () => {
    setup([ep("2026-01-09", { status: "question", audio: { status: "ask" }, questions: [hours] })]);
    const r = rowOf("2026-01-09");
    expect(r).not.toHaveTextContent(/by hand/);
    expect(r).not.toHaveTextContent(/aircheck-audio\/inbox/);
    expect(r).toHaveTextContent('The Box folder "RECAP 1-9-26" is a special folder');
    expect(within(r).getByLabelText("Hour 1")).toBeInTheDocument();
  });

  it("hand copy stays for an unclear folder with no fix to offer", () => {
    setup([ep("2026-01-09", { status: "question", audio: { status: "ask" } })]);
    expect(rowOf("2026-01-09")).toHaveTextContent(/copy the two hour files to the inbox by hand/);
  });

  it("stamp: 'This show is <folderDate>' calls useFolderDate; the answer box stays", async () => {
    const { acts } = setup([ep("2026-01-09", { status: "question", audio: { status: "ask" }, questions: [stamp] })]);
    const r = rowOf("2026-01-09");
    expect(within(r).getByLabelText(stamp.text)).toBeInTheDocument();
    await click(within(r).getByRole("button", { name: "This show is Jan 9, 2026" }));
    expect(acts.useFolderDate).toHaveBeenCalledWith({ showDate: "2026-01-09" });
  });

  it("tracklist: 'Fix the tracklist' opens the editor on that row", async () => {
    const { acts } = setup([ep("2026-01-09", { status: "question", questions: [badLine] })]);
    const r = rowOf("2026-01-09");
    await click(within(r).getByRole("button", { name: "Fix the tracklist" }));
    expect(acts.tracklistText).toHaveBeenCalledWith("2026-01-09");
    expect((within(r).getByLabelText("Tracklist for Jan 9, 2026") as HTMLTextAreaElement).value).toContain("Donalyd Byrd");
  });

  it("a refused fix shows Convex's plain words (R3: audio already downloaded)", async () => {
    const acts = actions({ pick: vi.fn(async () => { throw new ConvexError({ code: "BAD_INPUT", message: "this show's audio is already downloaded" }); }) });
    setup([ep("2026-01-09", { status: "question", questions: [boxPick] })], { acts });
    await click(within(rowOf("2026-01-09")).getAllByRole("button", { name: "Use this one" })[0]!);
    expect(within(rowOf("2026-01-09")).getByRole("alert")).toHaveTextContent("this show's audio is already downloaded");
  });

  it("the rerun question stays as it is", () => {
    setup([ep("2026-01-02"), ep("2026-01-09", { status: "question", questions: [{ id: "r", kind: "rerun", text: "x", rerunOf: "2026-01-02" }] })]);
    expect(within(rowOf("2026-01-09")).getByRole("button", { name: "Yes, a rerun" })).toBeInTheDocument();
    expect(within(rowOf("2026-01-09")).queryByRole("button", { name: /This show is/ })).not.toBeInTheDocument();
  });
});

describe("Edit tracklist on the row", () => {
  it("is offered with no package, no open run and no rerun mark", async () => {
    const { acts } = setup([
      ep("2026-01-02", { status: "awaiting-review", packageStatus: "awaiting_review" }),
      ep("2026-01-09"),
      ep("2026-01-16", { openRun: true }),
      ep("2026-01-23", { status: "rerun", rerunOf: "2026-01-09", rerunSource: "episodes" }),
    ], { today: "2026-01-23" });
    for (const d of ["2026-01-02", "2026-01-16", "2026-01-23"]) expect(within(rowOf(d)).queryByRole("button", { name: "Edit tracklist" })).not.toBeInTheDocument();
    await click(within(rowOf("2026-01-09")).getByRole("button", { name: "Edit tracklist" }));
    const box = within(rowOf("2026-01-09")).getByLabelText("Tracklist for Jan 9, 2026");
    fireEvent.change(box, { target: { value: "HOUR 1\nDonald Byrd - \"Change\"\nHOUR 2\nB - \"Two\"" } });
    await click(within(rowOf("2026-01-09")).getByRole("button", { name: "Save tracklist" }));
    expect(acts.setTracklist).toHaveBeenCalledWith({ showDate: "2026-01-09", text: "HOUR 1\nDonald Byrd - \"Change\"\nHOUR 2\nB - \"Two\"" });
    expect(screen.getByRole("status")).toHaveTextContent(CHECKING);
    expect(within(rowOf("2026-01-09")).queryByLabelText("Tracklist for Jan 9, 2026")).not.toBeInTheDocument();
  });
});

describe("the corrected line", () => {
  it("reads 'Corrected in Air Check' with the fields in words", () => {
    setup([ep("2026-01-09", { corrected: { fields: ["tracklist", "hours"], at: 1, stale: false } })]);
    expect(rowOf("2026-01-09")).toHaveTextContent("Corrected in Air Check (tracklist, which files are Hour 1 and Hour 2)");
  });

  it("'Use Drive again' asks once more before calling clearCorrection", async () => {
    const { acts } = setup([ep("2026-01-09", { corrected: { fields: ["drive"], at: 1, stale: false } })]);
    const r = rowOf("2026-01-09");
    await click(within(r).getByRole("button", { name: "Use Drive again" }));
    expect(acts.clearCorrection).not.toHaveBeenCalled();
    expect(r).toHaveTextContent("Your fix will be removed.");
    fireEvent.click(within(r).getByRole("button", { name: "Keep my fix" }));
    expect(r).not.toHaveTextContent("Your fix will be removed.");
    await click(within(r).getByRole("button", { name: "Use Drive again" }));
    await click(within(r).getByRole("button", { name: "Remove my fix" }));
    expect(acts.clearCorrection).toHaveBeenCalledWith({ showDate: "2026-01-09" });
    expect(screen.getByRole("status")).toHaveTextContent("Your fix was removed. Checking again in a minute or two.");
  });

  it("a stale fix says so and that the show won't draft", () => {
    setup([ep("2026-01-09", { corrected: { fields: ["tracklist"], at: 1, stale: true } })]);
    const r = rowOf("2026-01-09");
    expect(r).toHaveTextContent("Your fix no longer matches Drive. Use Drive again or fix it again.");
    expect(r).toHaveTextContent("This show won't be drafted until then.");
    expect(r).not.toHaveTextContent("Corrected in Air Check");
    expect(within(r).getByText("Fix needs a look")).toBeInTheDocument();
    expect(within(r).queryByText("Waiting to draft")).not.toBeInTheDocument();
    expect(within(r).getByRole("button", { name: "Use Drive again" })).toBeInTheDocument();
  });

  it("a fix waiting for its scan says 'Checking your fix…' and keeps the row's controls", () => {
    setup([ep("2026-01-09", { rescanPending: true, corrected: { fields: ["tracklist"], at: 1, stale: true } })]);
    const r = rowOf("2026-01-09");
    expect(r).toHaveTextContent("Checking your fix…");
    expect(r).not.toHaveTextContent("no longer matches"); // the stale flag is from the scan before the fix
    expect(within(r).getByText("Checking your fix")).toBeInTheDocument(); // the pill, not "Waiting to draft"
    expect(within(r).getByRole("button", { name: "Edit tracklist" })).toBeInTheDocument();
    expect(within(r).getByRole("button", { name: "Use Drive again" })).toBeInTheDocument();
  });

  it("a show with a package hides the fix buttons (it is changed on the package page)", () => {
    setup([ep("2026-01-09", { status: "awaiting-review", packageStatus: "awaiting_review", corrected: { fields: ["tracklist"], at: 1, stale: false } })]);
    const r = rowOf("2026-01-09");
    expect(r).toHaveTextContent("Corrected in Air Check (tracklist)");
    expect(within(r).queryByRole("button", { name: "Use Drive again" })).not.toBeInTheDocument();
  });
});

describe("undated names", () => {
  const items: Unplaced[] = [
    { source: "drive", id: "d1", name: "Rhythm Lab playlist (final)", reason: "no date in the name", seenAt: 1 },
    { source: "box", id: "b1", name: "RLR spring special", reason: "no date in the name", seenAt: 1 },
  ];

  it("lists each item with its source and name, and places it on a 2026 show", async () => {
    const { acts } = setup([ep("2026-01-09")], { unplaced: items });
    const section = screen.getByRole("region", { name: "Couldn't tell the date of these" });
    const first = within(section).getByText("Rhythm Lab playlist (final)").closest("li")!;
    expect(first).toHaveTextContent("Google Drive");
    const date = within(first).getByLabelText("This is the show for…");
    expect(date).toHaveAttribute("type", "date");
    expect(date).toHaveAttribute("min", "2026-01-01");
    expect(date).toHaveAttribute("max", "2026-12-31");
    expect(within(first).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(date, { target: { value: "2026-01-09" } });
    await click(within(first).getByRole("button", { name: "Save" }));
    expect(acts.place).toHaveBeenCalledWith({ source: "drive", id: "d1", date: "2026-01-09" });
    expect(screen.getByRole("status")).toHaveTextContent(CHECKING);
    expect(first).toHaveTextContent("Saved as the show for Jan 9, 2026.");
    await click(within(first).getByRole("button", { name: "Undo" }));
    expect(acts.unplace).toHaveBeenCalledWith({ source: "drive", id: "d1" });
  });

  it("sits above the table, and a placed item disappears after the rescan", () => {
    const { rerender } = setup([ep("2026-01-09")], { unplaced: items });
    const section = screen.getByRole("region", { name: "Couldn't tell the date of these" });
    expect(section.compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender([ep("2026-01-09")], items.slice(1));
    expect(screen.queryByText("Rhythm Lab playlist (final)")).not.toBeInTheDocument();
    expect(screen.getByText("RLR spring special")).toBeInTheDocument();
  });

  it("is absent with nothing unplaced (empty or not loaded)", () => {
    const { rerender } = setup([ep("2026-01-09")], { unplaced: [] });
    expect(screen.queryByRole("region", { name: "Couldn't tell the date of these" })).not.toBeInTheDocument();
    rerender([ep("2026-01-09")], null);
    expect(screen.queryByText("Couldn't tell the date of these")).not.toBeInTheDocument();
  });
});

describe("phone cards", () => {
  it("render the same controls", async () => {
    const { acts } = setup(
      [ep("2026-01-09", { status: "question", audio: { status: "ask" }, questions: [boxPick, hours, badLine], corrected: { fields: ["paper"], at: 1, stale: false } })],
      { layout: "cards", unplaced: [{ source: "paper", id: "p1", name: "notes", reason: "no date", seenAt: 1 }] },
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const card = rowOf("2026-01-09");
    expect(card.tagName).toBe("LI");
    expect(within(card).getAllByRole("button", { name: "Use this one" })).toHaveLength(2);
    expect(within(card).getByLabelText("Hour 1")).toBeInTheDocument();
    expect(card).toHaveTextContent("Corrected in Air Check (which Paper doc)");
    expect(within(card).getByRole("button", { name: "Use Drive again" })).toBeInTheDocument();
    await click(within(card).getByRole("button", { name: "Fix the tracklist" }));
    expect(within(card).getByLabelText("Tracklist for Jan 9, 2026")).toBeInTheDocument();
    expect(acts.tracklistText).toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Couldn't tell the date of these" })).toHaveTextContent("Dropbox Paper");
  });
});

describe("demo", () => {
  it("is unchanged: no backlog, no undated list", () => {
    render(<EpisodesView data={null} unplaced={null} sources={null} workspace="demo" today="2026-10-28" actions={actions()} />);
    expect(screen.getByText("The demo doesn't include the backlog.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't tell the date of these")).not.toBeInTheDocument();
  });
});
