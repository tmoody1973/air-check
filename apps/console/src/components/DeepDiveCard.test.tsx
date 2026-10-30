// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepDiveCard } from "./DeepDiveCard";
import { claim, deepDiveView, entry, src, TODAY } from "./research.fixture";

afterEach(cleanup);

const actions = { edit: vi.fn(), setPrivate: vi.fn(), setNote: vi.fn(), regenerate: vi.fn() };

describe("DeepDiveCard (Oct 30, decision 023: an article, like our own Wikipedia page)", () => {
  it("an infobox, a lead with no heading, one paragraph per section, connections, checks and numbered references", () => {
    render(<DeepDiveCard view={deepDiveView(12)} today={TODAY} actions={actions} />);
    const box = screen.getByRole("complementary", { name: "[Artist A] at a glance" });
    expect(within(box).getByText("Origin")).toBeInTheDocument();
    expect(within(box).getByText("[City]")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Origins", "Career", "Sound and influences", "Key records", "Legacy", "Connects to your list", "What I couldn't verify", "References",
    ]);
    for (let i = 1; i <= 12; i++) expect(screen.getByText(`Fact ${i} about [Artist A].`)).toBeInTheDocument();
    // Facts 1 and 7 are the lead: one paragraph, before any heading.
    expect(screen.getByText("Fact 1 about [Artist A].").closest("p")).toBe(screen.getByText("Fact 7 about [Artist A].").closest("p"));
    // The infobox cites first, so its source is [1]; each citation links to its reference.
    const cite = within(box).getByRole("link", { name: "1" });
    expect(cite).toHaveAttribute("href", "#ref-1");
    const refs = screen.getByRole("list", { name: "References" });
    const first = within(refs).getAllByRole("listitem")[0]!;
    expect(first).toHaveAttribute("id", "ref-1");
    expect(within(first).getByRole("link", { name: "[Page o1]" })).toHaveAttribute("href", "https://example.org/o1");
    expect(first).toHaveTextContent("· example.org");
    expect(screen.getByText("[Artist C] – “[Title C]”")).toBeInTheDocument();
    expect(screen.queryByText(/Never shown: a closing track/)).not.toBeInTheDocument();
    // A [verify] fact stays in its section, marked, and is listed with code's check.
    expect(screen.getByText("Played bass on [Album X].").parentElement).toHaveTextContent("[verify]");
    expect(screen.getByText("Played bass on [Album X] (only one source: example.org)")).toBeInTheDocument();
    expect(screen.queryByText(/could be sourced/)).not.toBeInTheDocument();
  });

  it("fewer than 10 sourced facts: Only N facts could be sourced", () => {
    render(<DeepDiveCard view={deepDiveView(3)} today={TODAY} actions={actions} />);
    expect(screen.getByText("Only 3 facts could be sourced.")).toBeInTheDocument();
  });

  it("an older brief's kinds land in their sections", () => {
    const v = deepDiveView(0, { entries: [entry("brief", { claims: [claim({ kind: "fun-fact", text: "An old fun fact." }), claim({ kind: "bio", text: "An old bio.", sources: [src("b")] })] })] });
    render(<DeepDiveCard view={v} today={TODAY} actions={actions} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Origins", "Legacy", "References"]);
    expect(screen.getByText("An old bio.").closest("section")).toHaveTextContent(/^Origins/);
  });

  it("the code line On Rhythm Lab only for a count of 1 or more (R10)", () => {
    render(<DeepDiveCard view={deepDiveView(10, { pastShows: { count: 2, year: 2026, last: "2026-10-02" } })} today={TODAY} actions={actions} />);
    expect(screen.getByText("On Rhythm Lab: 2 shows in 2026, last Oct 2, 2026")).toBeInTheDocument();
    cleanup();
    render(<DeepDiveCard view={deepDiveView(10, { pastShows: { count: 1, year: 2026 } })} today={TODAY} actions={actions} />);
    expect(screen.getByText("On Rhythm Lab: 1 show in 2026")).toBeInTheDocument();
    cleanup();
    render(<DeepDiveCard view={deepDiveView(10, { pastShows: { count: 0, year: 2026 } })} today={TODAY} actions={actions} />);
    expect(screen.queryByText(/On Rhythm Lab/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No past shows/)).not.toBeInTheDocument();
  });

  it("an embargoed subject is Private", () => {
    render(<DeepDiveCard view={deepDiveView(10, { subjectEmbargo: { until: null } })} today={TODAY} actions={actions} />);
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Embargoed · date not known")).toBeInTheDocument();
  });

  it("a connection to an embargoed track is marked Private", () => {
    const v = deepDiveView(10);
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
