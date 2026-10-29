// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeItem } from "./EpisodeItem";
import { EpisodesView, type EpisodeActions, type EpisodeRow } from "./EpisodesView";
import type { SourceStatus } from "./SourceConnections";

afterEach(cleanup);

const ep = (showDate: string, over: Partial<EpisodeRow> = {}): EpisodeRow => ({
  showDate,
  audio: { status: "ready" },
  tracklist: { status: "found" },
  notes: { status: "found" },
  questions: [],
  status: "ready-to-draft",
  gaps: [],
  packageId: "pkg-x",
  packageStatus: "none",
  draftAttempts: 0,
  ...over,
});
const connected: SourceStatus[] = (["box", "google", "dropbox"] as const).map((source) => ({ source, state: "connected" }));
const noop = async () => undefined;
const actions = (over: Partial<EpisodeActions> = {}): EpisodeActions => ({ answer: vi.fn(noop), markRerun: vi.fn(noop), unmarkRerun: vi.fn(noop), ...over });

function setup(episodes: EpisodeRow[], { sources = connected, today = "2026-01-23", acts = actions() } = {}) {
  render(<EpisodesView data={{ episodes, awaitingReview: 0 }} sources={sources} workspace="real" today={today} actions={acts} />);
  return acts;
}
const rowOf = (date: string) => document.getElementById(`ep-${date}`)!;

describe("EpisodesView states", () => {
  it("demo: a plain note, no table, nothing real", () => {
    render(<EpisodesView data={null} sources={null} workspace="demo" today="2026-10-28" actions={actions()} />);
    expect(screen.getByText("The demo doesn't include the backlog.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("loading, not allowed, and nothing scanned yet", () => {
    const { rerender } = render(<EpisodesView data={undefined} sources={undefined} workspace="real" today="2026-10-28" actions={actions()} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<EpisodesView data={null} sources={null} workspace="real" today="2026-10-28" actions={actions()} />);
    expect(screen.getByText(/can't use Air Check/)).toBeInTheDocument();
    rerender(<EpisodesView data={{ episodes: [], awaitingReview: 0 }} sources={[]} workspace="real" today="2026-10-28" actions={actions()} />);
    expect(screen.getByText(/No shows found yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("EpisodesView table", () => {
  it("summary line, oldest first, blank Fridays as gap rows (never invented as shows)", () => {
    setup([ep("2026-01-16", { status: "missing-audio", gaps: ["audio"], audio: { status: "none" } }), ep("2026-01-09")]);
    expect(screen.getByText("2 shows · 1 missing audio · 2 blank Fridays")).toBeInTheDocument();
    const dates = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(dates).toEqual(["Jan 2, 2026", "Jan 9, 2026", "Jan 16, 2026", "Jan 23, 2026"]);
    expect(within(rowOf("2026-01-02")).getByText("No show folder or tracklist found")).toBeInTheDocument();
    expect(within(rowOf("2026-01-16")).getByText("Missing")).toBeInTheDocument();
    expect(within(rowOf("2026-01-16")).getByText("No audio")).toBeInTheDocument();
  });

  it("links the package when drafted and Mixcloud when published", () => {
    setup([
      ep("2026-01-09", { status: "published", packageStatus: "succeeded", receiptUrl: "https://www.mixcloud.com/rhythmlab/x/", packageId: "pkg-1-9-26" }),
      ep("2026-01-16", { status: "awaiting-review", packageStatus: "awaiting_review", packageId: "pkg-1-16-26" }),
    ], { today: "2026-01-16" });
    expect(within(rowOf("2026-01-09")).getByRole("link", { name: "On Mixcloud" })).toHaveAttribute("href", "https://www.mixcloud.com/rhythmlab/x/");
    expect(within(rowOf("2026-01-16")).getByRole("link", { name: "Open package" })).toHaveAttribute("href", "/packages/pkg-1-16-26");
  });

  it("R13: a not-connected source reads — with a header note; R14: a failing one shows the paused banner", () => {
    setup([ep("2026-01-09", { tracklist: { status: "missing" }, gaps: ["tracklist"] })], {
      sources: [{ source: "box", state: "connected" }, { source: "dropbox", state: "needs_reconnect" }],
      today: "2026-01-09",
    });
    expect(screen.getByRole("link", { name: "Connect Google in Settings" })).toHaveAttribute("href", "/settings");
    expect(within(rowOf("2026-01-09")).getByText("—")).toBeInTheDocument();
    expect(within(rowOf("2026-01-09")).queryByText("Missing")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect Dropbox in Settings" }).parentElement!.parentElement).toHaveTextContent("Reconnect Dropbox in Settings — drafting is paused.");
  });

  it("R10, R5 and a failed download explain themselves in plain words", () => {
    setup([
      ep("2026-01-02", { status: "draft-failed", draftAttempts: 2 }),
      ep("2026-01-09", { status: "question", audio: { status: "ask" }, gaps: ["audio"] }),
      ep("2026-01-16", { fetch: { status: "failed", error: "http_404" } }),
    ], { today: "2026-01-16" });
    expect(rowOf("2026-01-02")).toHaveTextContent("The agent couldn't draft this show twice — open Chat to try, or check the tracklist");
    expect(within(rowOf("2026-01-02")).getByRole("link", { name: "open Chat" })).toHaveAttribute("href", "/chat");
    expect(within(rowOf("2026-01-09")).getByText(/Audio folder unclear — copy the two hour files to the inbox by hand/)).toBeInTheDocument();
    expect(within(rowOf("2026-01-09")).getByText(/aircheck-audio\/inbox\/2026-01-09/)).toBeInTheDocument();
    expect(rowOf("2026-01-09")).toHaveTextContent("then draft it from the Tracklist page"); // I4: not a dead end
    expect(within(rowOf("2026-01-09")).getByRole("link", { name: "Tracklist page" })).toHaveAttribute("href", "/tracklist");
    expect(within(rowOf("2026-01-16")).getByText("Download failed (Box couldn't find the file)")).toBeInTheDocument();
  });
});

describe("EpisodesView questions", () => {
  it("answers a question inline, announces the save, and shows answered ones", async () => {
    const acts = setup([
      ep("2026-01-09", { status: "question", questions: [{ id: "t1", kind: "tracklist", text: "Keep track 3?" }, { id: "t2", kind: "date", text: "Which date?", answer: "Jan 9" }] }),
    ], { today: "2026-01-09" });
    expect(screen.getByText("You answered: Jan 9")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Keep track 3?"), { target: { value: "Yes, keep it" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save answer" })));
    expect(acts.answer).toHaveBeenCalledWith({ showDate: "2026-01-09", questionId: "t1", answer: "Yes, keep it" });
    expect(screen.getByRole("status")).toHaveTextContent("Answer saved for Jan 9, 2026");
  });

  it("a refused save shows Convex's plain reason; any other error never shows raw server text", async () => {
    const refuse = (err: unknown) => {
      cleanup();
      const acts = actions({ answer: vi.fn(async () => { throw err; }) });
      setup([ep("2026-01-09", { status: "question", questions: [{ id: "t1", kind: "tracklist", text: "Keep track 3?" }] })], { today: "2026-01-09", acts });
      fireEvent.change(screen.getByLabelText("Keep track 3?"), { target: { value: "x" } });
      return act(async () => fireEvent.click(screen.getByRole("button", { name: "Save answer" })));
    };
    await refuse(new ConvexError({ code: "BAD_INPUT", message: "the answer must be 1 to 2000 characters" }));
    expect(screen.getByRole("alert")).toHaveTextContent("the answer must be 1 to 2000 characters");
    await refuse(new Error("[CONVEX M(episodes:answer)] [Request ID: 1a2b] Server Error Uncaught Error: boom at handler"));
    expect(screen.getByRole("alert")).toHaveTextContent("That didn't save. Try again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/CONVEX|boom/);
    await refuse(new ConvexError("a bare string"));
    expect(screen.getByRole("alert")).toHaveTextContent("That didn't save. Try again.");
  });

  it("the same message twice is announced twice (the live region's text changes)", async () => {
    setup([ep("2026-01-09", { status: "question", questions: [{ id: "t1", kind: "tracklist", text: "Keep track 3?" }] })], { today: "2026-01-09" });
    fireEvent.change(screen.getByLabelText("Keep track 3?"), { target: { value: "x" } });
    const save = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Save answer" })));
    await save();
    const first = screen.getByRole("status").textContent;
    await save();
    const second = screen.getByRole("status").textContent;
    expect(first).toContain("Answer saved for Jan 9, 2026");
    expect(second).toContain("Answer saved for Jan 9, 2026");
    expect(second).not.toBe(first);
  });

  it("rerun question with a candidate: Yes or No", async () => {
    const acts = setup([
      ep("2026-01-02"),
      ep("2026-01-16", { status: "question", questions: [{ id: "r", kind: "rerun", text: "x", rerunOf: "2026-01-02" }] }),
    ], { today: "2026-01-16" });
    expect(screen.getByText("Is Jan 16, 2026 a rerun of Jan 2, 2026?")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes, a rerun" })));
    expect(acts.answer).toHaveBeenCalledWith({ showDate: "2026-01-16", questionId: "r", answer: "Yes" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "No" })));
    expect(acts.answer).toHaveBeenLastCalledWith({ showDate: "2026-01-16", questionId: "r", answer: "No" });
  });

  it("R8: unknown original asks which show; Yes needs an earlier date", async () => {
    const acts = setup([
      ep("2026-01-02"),
      ep("2026-01-09", { status: "rerun", rerunOf: "2026-01-02", rerunSource: "chat" }),
      ep("2026-01-16", { status: "question", questions: [{ id: "r", kind: "rerun", text: "x", rerunOf: "" }] }),
      ep("2026-01-23"),
    ], { today: "2026-01-23" });
    expect(screen.getByText("Is Jan 16, 2026 a rerun, and of which show?")).toBeInTheDocument();
    const yes = within(rowOf("2026-01-16")).getByRole("button", { name: "Yes, a rerun" });
    expect(yes).toBeDisabled();
    const pick = within(rowOf("2026-01-16")).getByLabelText("Rerun of");
    // Only earlier shows that are not reruns themselves.
    expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a show", "Jan 2, 2026"]);
    fireEvent.change(pick, { target: { value: "2026-01-02" } });
    await act(async () => fireEvent.click(yes));
    expect(acts.answer).toHaveBeenCalledWith({ showDate: "2026-01-16", questionId: "r", answer: "Yes", rerunOf: "2026-01-02" });
  });
});

describe("EpisodesView reruns", () => {
  it("R7/R9: says who marked it, links the original row, and Undo clears it", async () => {
    const acts = setup([
      ep("2026-01-02"),
      ep("2026-01-09", { status: "rerun", rerunOf: "2026-01-02", rerunSource: "chat" }),
      ep("2026-01-16", { status: "rerun", rerunOf: "2026-01-02", rerunSource: "episodes" }),
    ], { today: "2026-01-16" });
    const r = rowOf("2026-01-09");
    expect(r).toHaveTextContent("Rerun of Jan 2, 2026 (you said, in Chat)");
    expect(within(r).getByRole("link", { name: "Jan 2, 2026" })).toHaveAttribute("href", "#ep-2026-01-02");
    expect(rowOf("2026-01-16")).toHaveTextContent("(marked here)");
    await act(async () => fireEvent.click(within(r).getByRole("button", { name: "Undo" })));
    expect(acts.unmarkRerun).toHaveBeenCalledWith({ showDate: "2026-01-09" });
  });

  it("I2: a pre-2026 original is plain text (it has no row to link to)", () => {
    setup([ep("2026-01-02", { status: "rerun", rerunOf: "2025-12-19", rerunSource: "detected" })], { today: "2026-01-02" });
    const r = rowOf("2026-01-02");
    expect(r).toHaveTextContent("Rerun of Dec 19, 2025 (confirmed)");
    expect(within(r).queryByRole("link", { name: "Dec 19, 2025" })).not.toBeInTheDocument();
  });

  it("R12: a confirmed (detected) rerun's Undo is labelled 'not a rerun'", () => {
    setup([ep("2026-01-02"), ep("2026-01-09", { status: "rerun", rerunOf: "2026-01-02", rerunSource: "detected" })], { today: "2026-01-09" });
    const r = rowOf("2026-01-09");
    expect(r).toHaveTextContent("(confirmed)");
    expect(within(r).getByRole("button", { name: "Undo: not a rerun" })).toBeInTheDocument();
  });

  it("Mark as rerun of… chooses an earlier show, on a show row or a blank Friday", async () => {
    const acts = setup([ep("2026-01-02"), ep("2026-01-09")], { today: "2026-01-16" });
    expect(within(rowOf("2026-01-02")).queryByRole("button", { name: "Mark as rerun of…" })).not.toBeInTheDocument();
    fireEvent.click(within(rowOf("2026-01-16")).getByRole("button", { name: "Mark as rerun of…" }));
    const pick = within(rowOf("2026-01-16")).getByLabelText("Rerun of");
    expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a show", "Jan 2, 2026", "Jan 9, 2026"]);
    fireEvent.change(pick, { target: { value: "2026-01-09" } });
    await act(async () => fireEvent.click(within(rowOf("2026-01-16")).getByRole("button", { name: "Save" })));
    expect(acts.markRerun).toHaveBeenCalledWith({ showDate: "2026-01-16", rerunOf: "2026-01-09" });
    expect(screen.getByRole("status")).toHaveTextContent("Jan 16, 2026 marked as a rerun of Jan 9, 2026");
  });

  it("M2: an open draft run with no package says Drafting and hides Mark; a package waiting for its MP3 says Preparing audio", () => {
    setup([ep("2026-01-02", { openRun: true }), ep("2026-01-09", { status: "drafting", packageStatus: "preparing_audio" }), ep("2026-01-16")], { today: "2026-01-16" });
    expect(within(rowOf("2026-01-02")).getByText("Drafting")).toBeInTheDocument();
    expect(within(rowOf("2026-01-02")).queryByRole("button", { name: "Mark as rerun of…" })).not.toBeInTheDocument();
    expect(within(rowOf("2026-01-09")).getByText("Preparing audio")).toBeInTheDocument();
    expect(within(rowOf("2026-01-09")).queryByText("Drafting")).not.toBeInTheDocument();
    expect(within(rowOf("2026-01-16")).getByText("Waiting to draft")).toBeInTheDocument();
    expect(within(rowOf("2026-01-16")).getByRole("button", { name: "Mark as rerun of…" })).toBeInTheDocument();
  });

  it("no Mark control once a show has a package", () => {
    setup([ep("2026-01-02"), ep("2026-01-09", { status: "awaiting-review", packageStatus: "awaiting_review" })], { today: "2026-01-09" });
    expect(within(rowOf("2026-01-09")).queryByRole("button", { name: "Mark as rerun of…" })).not.toBeInTheDocument();
  });
});

describe("EpisodeItem as a card (R15: phone width, no sideways scroll)", () => {
  const ctx = (acts = actions()) => ({ actions: acts, announce: vi.fn(), choices: ["2026-01-02", "2026-01-09"] });

  it("stacks date and status, three labelled source lines, the full-width answer box and the rerun control", async () => {
    const acts = actions();
    render(
      <ul>
        <EpisodeItem
          layout="card"
          showDate="2026-01-16"
          e={ep("2026-01-16", { status: "question", notes: { status: "missing" }, gaps: ["notes"], questions: [{ id: "t1", kind: "tracklist", text: "Keep track 3?" }] })}
          sources={{ box: "connected", google: "not_connected", dropbox: "connected" }}
          ctx={ctx(acts)}
        />
      </ul>,
    );
    const card = rowOf("2026-01-16");
    expect(card.tagName).toBe("LI");
    expect(within(card).getByRole("heading", { name: "Jan 16, 2026" })).toBeInTheDocument();
    expect(within(card).getByText("Question for you")).toBeInTheDocument();
    expect(within(card).getByText("Audio").nextElementSibling).toHaveTextContent("In Box");
    expect(within(card).getByText("Tracklist").nextElementSibling).toHaveTextContent("Not connected");
    expect(within(card).getByText("Notes").nextElementSibling).toHaveTextContent("Missing");
    const box = within(card).getByLabelText("Keep track 3?");
    expect(box).toHaveClass("w-full");
    fireEvent.change(box, { target: { value: "Yes" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Save answer" })));
    expect(acts.answer).toHaveBeenCalledWith({ showDate: "2026-01-16", questionId: "t1", answer: "Yes" });
    fireEvent.click(within(card).getByRole("button", { name: "Mark as rerun of…" }));
    expect(within(card).getByLabelText("Rerun of")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("a blank Friday card says so and can be marked", () => {
    render(<ul><EpisodeItem layout="card" showDate="2026-01-23" e={null} sources={{}} ctx={ctx()} /></ul>);
    const card = rowOf("2026-01-23");
    expect(within(card).getByText("Blank Friday")).toBeInTheDocument();
    expect(within(card).getByText("No show folder or tracklist found")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Mark as rerun of…" })).toBeInTheDocument();
  });

  it("the view in card layout keeps the summary line, blank Fridays and the Connect note", () => {
    render(
      <EpisodesView layout="cards" data={{ episodes: [ep("2026-01-09")], awaitingReview: 0 }} sources={[{ source: "box", state: "connected" }, { source: "dropbox", state: "connected" }]} workspace="real" today="2026-01-09" actions={actions()} />,
    );
    expect(screen.getByText("1 show · tracklists not connected · 1 blank Friday")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /2026 shows/ })).toBeInTheDocument();
    expect(rowOf("2026-01-02")).toHaveTextContent("No show folder or tracklist found");
    expect(screen.getByRole("link", { name: "Connect Google in Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("review fixes 4 and 6", () => {
  it("the Mark form closes after a save, so it does not reopen after Undo", async () => {
    const acts = actions();
    const view = (episodes: EpisodeRow[]) => <EpisodesView data={{ episodes, awaitingReview: 0 }} sources={connected} workspace="real" today="2026-01-09" actions={acts} />;
    const { rerender } = render(view([ep("2026-01-02"), ep("2026-01-09")]));
    fireEvent.click(within(rowOf("2026-01-09")).getByRole("button", { name: "Mark as rerun of…" }));
    fireEvent.change(within(rowOf("2026-01-09")).getByLabelText("Rerun of"), { target: { value: "2026-01-02" } });
    await act(async () => fireEvent.click(within(rowOf("2026-01-09")).getByRole("button", { name: "Save" })));
    expect(within(rowOf("2026-01-09")).queryByLabelText("Rerun of")).not.toBeInTheDocument();
    rerender(view([ep("2026-01-02"), ep("2026-01-09", { status: "rerun", rerunOf: "2026-01-02", rerunSource: "episodes" })]));
    await act(async () => fireEvent.click(within(rowOf("2026-01-09")).getByRole("button", { name: "Undo" })));
    rerender(view([ep("2026-01-02"), ep("2026-01-09")]));
    expect(within(rowOf("2026-01-09")).queryByLabelText("Rerun of")).not.toBeInTheDocument();
    expect(within(rowOf("2026-01-09")).getByRole("button", { name: "Mark as rerun of…" })).toBeInTheDocument();
  });

  it("a rerun row's source cells are neutral: a dash, 'Not needed', never red Missing", () => {
    setup([ep("2026-01-02"), ep("2026-01-09", { status: "rerun", rerunOf: "2026-01-02", rerunSource: "chat", audio: { status: "none" }, tracklist: { status: "missing" }, notes: { status: "missing" }, gaps: ["audio", "tracklist", "notes"] })], { today: "2026-01-09" });
    const r = rowOf("2026-01-09");
    expect(within(r).queryByText("Missing")).not.toBeInTheDocument();
    expect(within(r).getAllByText("Not needed")).toHaveLength(3);
    expect(within(r).getAllByText("—")).toHaveLength(3);
  });
});
