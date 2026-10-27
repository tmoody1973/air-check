// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRunEvent, initialRun, type RunState } from "@aircheck/core";
import events from "../../../../packages/core/test/fixtures/v12-events.json";
import { RunProgressCard } from "./RunProgressCard";

afterEach(cleanup);

const COPY = "Stops the agent at its next step.";
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
    render(<RunProgressCard title="Writing show notes · Hour 1" state={running()} totals={totals} upcoming={upcoming} status="running" source="scripted" onTakeOver={() => {}} />);
    expect(screen.getByRole("heading", { name: "Writing show notes · Hour 1" })).toBeInTheDocument();
    expect(screen.getAllByText("Done")).toHaveLength(1);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 tracks · 1 closing track skipped")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Take over")).toBeInTheDocument();
    expect(screen.getByText(COPY)).toBeInTheDocument();
    expect(screen.getByText("Sample run · replayed from a recorded session")).toBeInTheDocument();
    expect(screen.queryByText(/Live from the agent/)).not.toBeInTheDocument();
  });

  it("take over calls the handler", () => {
    const fn = vi.fn();
    render(<RunProgressCard title="t" state={running()} totals={totals} status="running" source="scripted" onTakeOver={fn} />);
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("stopping disables take over", () => {
    render(<RunProgressCard title="t" state={running()} totals={totals} status="stopping" source="scripted" upcoming={upcoming} onTakeOver={() => {}} />);
    const b = screen.getByRole("button", { name: "Stopping at the next step…" });
    expect(b).toBeDisabled();
  });

  it("cancelled shows stopped message", () => {
    render(<RunProgressCard title="t" state={replay()} totals={totals} upcoming={upcoming} status="cancelled" source="scripted" onTakeOver={() => {}} />);
    expect(screen.getByText("Stopped. You have it from here.")).toBeInTheDocument();
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
    render(<RunProgressCard title="t" state={state} totals={{ tracks: 2, closingSkipped: 0 }} upcoming={upcoming} status="running" source="scripted" onTakeOver={() => {}} />);
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
    render(<RunProgressCard title="t" state={initialRun("r")} totals={{ tracks: 0, closingSkipped: 0 }} upcoming={upcoming} status="running" source="scripted" onTakeOver={() => {}} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Sample · scripted")).toBeInTheDocument();
  });

  describe("live run states", () => {
    const base = { title: "t", totals: { tracks: 0, closingSkipped: 0 }, source: "live" as const };
    const liveState = (): RunState => ({ ...running(), status: "running" });

    it("take over calls the handler once, disables while in flight, and shows errors plainly", async () => {
      let reject!: (e: Error) => void;
      const fn = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
      render(<RunProgressCard {...base} status="running" state={liveState()} onTakeOver={fn} />);
      const b = screen.getByRole("button", { name: "Take over" });
      fireEvent.click(b);
      fireEvent.click(b);
      expect(fn).toHaveBeenCalledOnce();
      expect(b).toBeDisabled();
      reject(Object.assign(new Error("[CONVEX] Server Error"), { data: { code: "NOT_FOUND" } }));
      expect(await screen.findByText("That run no longer exists.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Take over" })).not.toBeDisabled();
    });

    it("a generic error shows plain copy and hides server detail", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fn = vi.fn(() => Promise.reject(new Error("[CONVEX M(runs:requestStop)] [Request ID abc] Server Error")));
      render(<RunProgressCard {...base} status="running" state={liveState()} onTakeOver={fn} />);
      fireEvent.click(screen.getByRole("button", { name: "Take over" }));
      expect(await screen.findByText("Could not stop the run. Please try again.")).toBeInTheDocument();
      expect(screen.queryByText(/Request ID/)).not.toBeInTheDocument();
    });

    it("Take over stays disabled with a hint until sign-in is ready", () => {
      const fn = vi.fn();
      render(<RunProgressCard {...base} authReady={false} status="running" state={liveState()} onTakeOver={fn} />);
      expect(screen.getByRole("button", { name: "Take over" })).toBeDisabled();
      expect(screen.getByText("Signing you in…")).toBeInTheDocument();
    });

    it("Take over is enabled once sign-in is ready", () => {
      render(<RunProgressCard {...base} authReady status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByRole("button", { name: "Take over" })).toBeEnabled();
      expect(screen.queryByText("Signing you in…")).not.toBeInTheDocument();
    });

    it("UNAUTHENTICATED shows the signing-in copy", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fn = vi.fn(() => Promise.reject(Object.assign(new Error("x"), { data: { code: "UNAUTHENTICATED" } })));
      render(<RunProgressCard {...base} status="running" state={liveState()} onTakeOver={fn} />);
      fireEvent.click(screen.getByRole("button", { name: "Take over" }));
      expect(await screen.findByText("Signing you in… try again in a moment.")).toBeInTheDocument();
    });

    it("queued copy next to Take over", () => {
      render(<RunProgressCard {...base} status="queued" state={{ runId: "r", status: "running", steps: [] }} onTakeOver={() => {}} />);
      expect(screen.getByText("Waiting for the agent…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Take over" })).toBeInTheDocument();
    });
    it("stopping copy and disabled button", () => {
      render(<RunProgressCard {...base} status="stopping" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Stopping at the next step…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Stopping at the next step/ })).toBeDisabled();
    });
    it("cancelled copy, no take over", () => {
      render(<RunProgressCard {...base} status="cancelled" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Stopped. You have it from here.")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
    it("failed copy", () => {
      render(<RunProgressCard {...base} status="failed" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("The run stopped with an error.")).toBeInTheDocument();
    });
    it("completed has no take over", () => {
      render(<RunProgressCard {...base} status="completed" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.queryByRole("button", { name: "Take over" })).not.toBeInTheDocument();
    });
    it("run without upcoming shows N steps done and no progressbar", () => {
      render(<RunProgressCard {...base} status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("1 step done")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
    it("run with upcoming keeps the track line and bar", () => {
      render(<RunProgressCard {...base} totals={totals} upcoming={upcoming} status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("1 of 4 tracks · 1 closing track skipped")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });
    it("source tags", () => {
      const { rerender } = render(<RunProgressCard {...base} status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Live · Nemotron")).toBeInTheDocument();
      rerender(<RunProgressCard {...base} source="scripted" status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Sample · scripted")).toBeInTheDocument();
      expect(screen.queryByText("Live · Nemotron")).not.toBeInTheDocument();
    });
    it("cancelled draft-package links to Tracklist; chat does not", () => {
      const { rerender } = render(<RunProgressCard {...base} runId="r9" kind="draft-package" status="cancelled" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByRole("link", { name: "Edit and draft again" })).toHaveAttribute("href", "/tracklist?from=r9");
      rerender(<RunProgressCard {...base} runId="r9" kind="chat" status="cancelled" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.queryByRole("link", { name: "Edit and draft again" })).not.toBeInTheDocument();
    });
    it("a terminal run shows the agent's final output as plain pre-wrapped text", () => {
      render(<RunProgressCard {...base} status="completed" state={{ ...liveState(), status: "completed", output: "Line one\nLine two" }} onTakeOver={() => {}} />);
      const out = screen.getByText(/Line one/);
      expect(out.textContent).toBe("Line one\nLine two");
      expect(out).toHaveClass("whitespace-pre-wrap");
    });
    it("falls back to the reply when output is empty", () => {
      render(<RunProgressCard {...base} status="failed" state={{ ...liveState(), status: "failed", output: "", reply: "Partial reply" }} onTakeOver={() => {}} />);
      expect(screen.getByText("Partial reply")).toBeInTheDocument();
    });
    it("HTML in the output is shown literally, never rendered", () => {
      const html = "<b>bold</b><img src=x onerror=alert(1)>";
      const { container } = render(<RunProgressCard {...base} status="completed" state={{ ...liveState(), status: "completed", output: html }} onTakeOver={() => {}} />);
      expect(screen.getByText(html)).toBeInTheDocument();
      expect(container.querySelector("b, img")).toBeNull();
    });
    it("a running run does not show output yet", () => {
      render(<RunProgressCard {...base} status="running" state={{ ...liveState(), reply: "streaming words" }} onTakeOver={() => {}} />);
      expect(screen.queryByText("streaming words")).not.toBeInTheDocument();
    });
    it("a completed draft-package run with no package says so and links back to Tracklist", () => {
      render(<RunProgressCard {...base} runId="r9" kind="draft-package" status="completed" state={{ ...liveState(), status: "completed" }} onTakeOver={() => {}} />);
      expect(screen.getByText("No package was created.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Edit and draft again" })).toHaveAttribute("href", "/tracklist?from=r9");
      expect(screen.queryByRole("link", { name: "Review package" })).not.toBeInTheDocument();
    });
    it("footer: live while the run is going, recorded once it ends", () => {
      const { rerender } = render(<RunProgressCard {...base} status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Live from the agent's run · steps stream in as they happen")).toBeInTheDocument();
      rerender(<RunProgressCard {...base} status="completed" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Recorded from the agent's run")).toBeInTheDocument();
      expect(screen.queryByText(/Live from the agent/)).not.toBeInTheDocument();
    });
    it("Take over copy says what it does; draft runs add the edit-and-redraft step", () => {
      const { rerender } = render(<RunProgressCard {...base} kind="chat" status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Stops the agent at its next step.")).toBeInTheDocument();
      rerender(<RunProgressCard {...base} kind="draft-package" status="running" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByText("Stops the agent at its next step. You can then edit the inputs and draft again.")).toBeInTheDocument();
    });
    it("Review package link", () => {
      render(<RunProgressCard {...base} packageId="p1" status="completed" state={liveState()} onTakeOver={() => {}} />);
      expect(screen.getByRole("link", { name: "Review package" })).toHaveAttribute("href", "/packages/p1");
    });
  });
});
