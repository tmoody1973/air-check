// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepDiveCard } from "./DeepDiveCard";
import { deepDiveView, TODAY } from "./research.fixture";

afterEach(cleanup);

const actions = { edit: vi.fn(), setPrivate: vi.fn(), setNote: vi.fn(), regenerate: vi.fn() };

describe("DeepDiveCard", () => {
  it("facts, Connects to your list, Could not verify; a closing track never connects", () => {
    render(<DeepDiveCard view={deepDiveView(6)} today={TODAY} actions={actions} />);
    for (let i = 1; i <= 6; i++) expect(screen.getByText(`Fact ${i} about [Artist A].`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connects to your list" })).toBeInTheDocument();
    expect(screen.getByText("[Artist C] – “[Title C]”")).toBeInTheDocument();
    expect(screen.queryByText(/Never shown: a closing track/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Could not verify" })).toBeInTheDocument();
    expect(screen.getByText("Played bass on [Album X].")).toBeInTheDocument();
    expect(screen.queryByText(/could be sourced/)).not.toBeInTheDocument();
  });

  it("fewer than 5 sourced facts: Only N facts could be sourced", () => {
    render(<DeepDiveCard view={deepDiveView(3)} today={TODAY} actions={actions} />);
    expect(screen.getByText("Only 3 facts could be sourced.")).toBeInTheDocument();
  });

  it("the code line On Rhythm Lab only for a count of 1 or more (R10)", () => {
    render(<DeepDiveCard view={deepDiveView(5, { pastShows: { count: 2, year: 2026, last: "2026-10-02" } })} today={TODAY} actions={actions} />);
    expect(screen.getByText("On Rhythm Lab: 2 shows in 2026, last Oct 2, 2026")).toBeInTheDocument();
    cleanup();
    render(<DeepDiveCard view={deepDiveView(5, { pastShows: { count: 1, year: 2026 } })} today={TODAY} actions={actions} />);
    expect(screen.getByText("On Rhythm Lab: 1 show in 2026")).toBeInTheDocument();
    cleanup();
    render(<DeepDiveCard view={deepDiveView(5, { pastShows: { count: 0, year: 2026 } })} today={TODAY} actions={actions} />);
    expect(screen.queryByText(/On Rhythm Lab/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No past shows/)).not.toBeInTheDocument();
  });

  it("an embargoed subject is Private", () => {
    render(<DeepDiveCard view={deepDiveView(5, { subjectEmbargo: { until: null } })} today={TODAY} actions={actions} />);
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Embargoed · date not known")).toBeInTheDocument();
  });

  it("a connection to an embargoed track is marked Private", () => {
    const v = deepDiveView(5);
    v.entries[0]!.claims.push({ kind: "connection", text: "Same studio.", value: "H1.2", status: "sourced", sources: [] });
    render(<DeepDiveCard view={v} today={TODAY} actions={actions} />);
    const item = screen.getByText("[Artist B] – “[Title B]”").closest("li")!;
    expect(item).toHaveTextContent("Private");
    expect(item).toHaveTextContent("Embargoed until Nov 7");
    expect(screen.getByText("[Artist C] – “[Title C]”").closest("li")!).not.toHaveTextContent("Private");
  });

  it("no brief yet", () => {
    render(<DeepDiveCard view={deepDiveView(0, { entries: [] })} today={TODAY} actions={actions} />);
    expect(screen.getByText("No brief yet.")).toBeInTheDocument();
  });
});
