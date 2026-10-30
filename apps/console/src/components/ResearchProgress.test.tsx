// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchProgress } from "./ResearchProgress";
import { deepDiveView, notesView, verifyView } from "./research.fixture";

afterEach(cleanup);

const noop = () => Promise.resolve();
const rowOf = (key: string) => screen.getByText(key).closest("li")!;

describe("ResearchProgress", () => {
  it("counts and time left come from research.get; closing rows are skipped; the next undone key reads Next", () => {
    render(<ResearchProgress view={notesView()} onTakeOver={noop} onResume={noop} />);
    expect(screen.getByText("2 of 4 tracks · 2 closing tracks skipped")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("about 3 min left")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(within(rowOf("H1.1")).getByText("Done")).toBeInTheDocument();
    expect(within(rowOf("H1.3")).getByText("Next")).toBeInTheDocument();
    expect(within(rowOf("H1.4")).getByText("Skipped")).toBeInTheDocument();
    expect(within(rowOf("H1.4")).getByText(/closing track, no notes/)).toBeInTheDocument();
    // Code never knows which key the agent is on.
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    expect(within(rowOf("H1.3")).getByText("checking label on Discogs…")).toBeInTheDocument();
  });

  it("source hosts as chips and [verify] chips in the caution style", () => {
    render(<ResearchProgress view={notesView()} onTakeOver={noop} onResume={noop} />);
    const row = rowOf("H1.1");
    expect(within(row).getByText("musicbrainz.org")).toBeInTheDocument();
    const chip = within(row).getByText("[verify] release date: sources disagree");
    expect(chip).toHaveClass("bg-caution-bg");
    expect(within(rowOf("H1.2")).getByText("Private")).toBeInTheDocument();
    expect(within(rowOf("H1.1")).queryByText("Private")).not.toBeInTheDocument();
  });

  it("Take over: R1 copy, calls the handler", () => {
    const onTakeOver = vi.fn(noop);
    render(<ResearchProgress view={notesView()} onTakeOver={onTakeOver} onResume={noop} />);
    expect(screen.getByText("Stops now. Everything saved so far stays.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(onTakeOver).toHaveBeenCalledOnce();
    expect(screen.getByText(/Live from the agent's run/)).toBeInTheDocument();
  });

  it("taken over with keys left: Resume, no Next", () => {
    const onResume = vi.fn(noop);
    render(<ResearchProgress view={notesView({ secondsLeft: undefined, lastStep: undefined }, { status: "taken-over" })} onTakeOver={noop} onResume={onResume} />);
    expect(screen.queryByRole("button", { name: "Take over" })).not.toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
    expect(within(rowOf("H1.3")).getByText("Not researched")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("a refused Resume shows its plain reason", async () => {
    const onResume = () => Promise.reject({ data: { code: "PAUSED", message: "Live research is paused for the demo today. The sample report is below." } });
    render(<ResearchProgress view={notesView({}, { status: "stopped" })} onTakeOver={noop} onResume={onResume} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Live research is paused for the demo today.");
  });

  it("a seeded sample says Sample, never Live", () => {
    render(<ResearchProgress view={notesView({}, { status: "done", runIds: [] })} onTakeOver={noop} onResume={noop} />);
    expect(screen.getByText("Sample")).toBeInTheDocument();
    expect(screen.queryByText("Live · Nemotron")).not.toBeInTheDocument();
  });

  it("verify and deep dive: counts without track rows", () => {
    render(<ResearchProgress view={verifyView({}, )} onTakeOver={noop} onResume={noop} />);
    expect(screen.getByText("2 of 3 lines checked · 1 line under closing tracks skipped")).toBeInTheDocument();
    cleanup();
    render(<ResearchProgress view={deepDiveView(5, { progress: { done: 0, total: 1 } })} onTakeOver={noop} onResume={noop} />);
    expect(screen.getByText("Writing the brief")).toBeInTheDocument();
  });
});
