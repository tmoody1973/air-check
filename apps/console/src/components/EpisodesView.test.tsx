// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("a refused save shows the reason", async () => {
    const acts = actions({ answer: vi.fn(async () => { throw new Error("the answer must be 1 to 2000 characters"); }) });
    setup([ep("2026-01-09", { status: "question", questions: [{ id: "t1", kind: "tracklist", text: "Keep track 3?" }] })], { today: "2026-01-09", acts });
    fireEvent.change(screen.getByLabelText("Keep track 3?"), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save answer" })));
    expect(screen.getByRole("alert")).toHaveTextContent("the answer must be 1 to 2000 characters");
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

  it("no Mark control once a show has a package", () => {
    setup([ep("2026-01-02"), ep("2026-01-09", { status: "awaiting-review", packageStatus: "awaiting_review" })], { today: "2026-01-09" });
    expect(within(rowOf("2026-01-09")).queryByRole("button", { name: "Mark as rerun of…" })).not.toBeInTheDocument();
  });
});
