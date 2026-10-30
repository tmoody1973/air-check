// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimReport } from "./ClaimReport";
import { TODAY, verifyView } from "./research.fixture";

afterEach(cleanup);

const actions = { edit: vi.fn(), setPrivate: vi.fn(), setNote: vi.fn(), regenerate: vi.fn() };

describe("ClaimReport", () => {
  it("the open list sits above the changes", () => {
    render(<ClaimReport view={verifyView()} today={TODAY} actions={actions} />);
    const open = screen.getByRole("heading", { name: /Still open/ });
    const changes = screen.getByRole("heading", { name: /Changes/ });
    expect(open.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Still open" })).getByText(/Only one source: example.org/)).toBeInTheDocument();
  });

  it("each change: Now and Change to, with a Copy button", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ClaimReport view={verifyView()} today={TODAY} actions={actions} />);
    const change = screen.getByText("L2").closest("article")!;
    expect(within(change).getByText("Now:")).toBeInTheDocument();
    expect(within(change).getByText("Out Oct 9 on [Label A].")).toBeInTheDocument();
    expect(within(change).getByText("Change to:")).toBeInTheDocument();
    expect(within(change).getByText(/^Out Oct 16 on \[Label A\]\./)).toBeInTheDocument();
    await act(async () => fireEvent.click(within(change).getByRole("button", { name: "Copy" })));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Out Oct 16 on \[Label A\]\./));
    expect(screen.getByRole("status")).toHaveTextContent("Copied the change for L2.");
  });

  it("station play context is labelled Context, not a claim", () => {
    render(<ClaimReport view={verifyView()} today={TODAY} actions={actions} />);
    expect(screen.getByText("Context, not a claim")).toBeInTheDocument();
    expect(screen.getByText("[Artist A] · 88nine · last played Oct 2, 2026")).toBeInTheDocument();
  });

  it("a line under an embargoed track is marked Private", () => {
    render(<ClaimReport view={verifyView()} today={TODAY} actions={actions} />);
    const open = within(screen.getByRole("list", { name: "Still open" })).getByText(/^L3/).closest("li")!;
    expect(within(open).getByText("Private")).toBeInTheDocument();
    expect(within(open).getByText("Embargoed until Nov 7")).toBeInTheDocument();
  });

  it("nothing open says so", () => {
    const v = verifyView();
    v.entries = v.entries.filter((e) => e.key !== "L3");
    render(<ClaimReport view={v} today={TODAY} actions={actions} />);
    expect(screen.getByText("Nothing open.")).toBeInTheDocument();
  });
});
