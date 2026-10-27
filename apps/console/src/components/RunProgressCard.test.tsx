// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRunEvent, initialRun, type RunState } from "@aircheck/core";
import events from "../../../../packages/core/test/fixtures/v12-events.json";
import { RunProgressCard } from "./RunProgressCard";

afterEach(cleanup);

const COPY = "Stops after this track and opens the draft for you to edit. The agent won't overwrite anything you change.";
const replay = (upTo = events.length): RunState =>
  events.slice(0, upTo).reduce((st, e, i) => applyRunEvent(st, e.event, e.data, i * 1000), initialRun("r1"));
const running = (): RunState => ({
  ...replay(3),
  status: "running",
});
const totals = { tracks: 4, closingSkipped: 1 };
const upcoming = [
  { label: "H1.7", text: "Next track", status: "next" as const },
  { label: "H1.15", text: "Closing track, no notes", status: "skipped" as const },
];

describe("RunProgressCard", () => {
  it("renders done, working and skipped rows from V12 replay state", () => {
    render(<RunProgressCard title="Writing show notes · Hour 1" state={running()} totals={totals} upcoming={upcoming} onTakeOver={() => {}} />);
    expect(screen.getByRole("heading", { name: "Writing show notes · Hour 1" })).toBeInTheDocument();
    expect(screen.getAllByText("Done")).toHaveLength(1);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 tracks · 1 closing track skipped")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Take over")).toBeInTheDocument();
    expect(screen.getByText(COPY)).toBeInTheDocument();
    expect(screen.getByText("Live from the agent's run · steps stream in as they happen")).toBeInTheDocument();
  });

  it("take over calls the handler", () => {
    const fn = vi.fn();
    render(<RunProgressCard title="t" state={running()} totals={totals} onTakeOver={fn} />);
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("stopping disables take over", () => {
    render(<RunProgressCard title="t" state={{ ...running(), status: "stopping" }} totals={totals} onTakeOver={() => {}} />);
    const b = screen.getByRole("button", { name: "Stopping after this track…" });
    expect(b).toBeDisabled();
  });

  it("cancelled shows stopped message", () => {
    render(<RunProgressCard title="t" state={replay()} totals={totals} onTakeOver={() => {}} />);
    expect(screen.getByText("Stopped. Your draft is open.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take over" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("verify chip appears for [verify] previews and sources", () => {
    const state: RunState = {
      runId: "r1", status: "running",
      steps: [
        { id: "a", tool: "x", preview: "Kiwanuka [verify] release date", status: "done", startedAt: 1, label: "H1.5", sources: ["discogs.com", "[verify] sources disagree"] },
      ],
    };
    render(<RunProgressCard title="t" state={state} totals={{ tracks: 2, closingSkipped: 0 }} onTakeOver={() => {}} />);
    expect(screen.getByText("H1.5")).toBeInTheDocument();
    const normal = screen.getByText("discogs.com");
    expect(normal).toHaveClass("bg-surface", "text-ink-soft", "border-line");
    expect(normal).not.toHaveClass("bg-caution-bg");
    for (const el of [screen.getByText("[verify] sources disagree"), screen.getByText("[verify]", { selector: "span" })]) {
      expect(el).toHaveClass("bg-caution-bg", "text-caution-text");
      expect(el).not.toHaveClass("bg-surface");
      expect(el).not.toHaveClass("text-ink-soft");
      expect(el).not.toHaveClass("border-line");
    }
  });

  it("guards zero total and shows Sample tag", () => {
    render(<RunProgressCard title="t" sample state={initialRun("r")} totals={{ tracks: 0, closingSkipped: 0 }} onTakeOver={() => {}} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Sample")).toBeInTheDocument();
  });
});
