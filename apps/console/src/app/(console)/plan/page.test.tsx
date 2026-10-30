// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const results: Record<string, unknown> = {};
const startDeepDive = vi.fn(async (_: unknown) => ({ jobId: "rj-deep01", runId: "r" }));
vi.mock("convex/react", () => ({
  useQuery: (name: string) => results[name],
  useMutation: () => startDeepDive,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock("../../../../convex/_generated/api", () => ({ api: { research: { list: "research.list", startDeepDive: "research.startDeepDive" } } }));
vi.mock("@/components/Shell", () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, useWorkspace: () => "real" }));

import PlanPage from "./page";

afterEach(() => {
  cleanup();
  push.mockClear();
  startDeepDive.mockClear();
});

describe("Plan page", () => {
  it("Deep dive form: type, name, optional show date; opens the research page", async () => {
    results["research.list"] = [];
    render(<PlanPage />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "label" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "[Label A]" } });
    fireEvent.change(screen.getByLabelText(/Show date/), { target: { value: "2026-10-30" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start deep dive" })));
    expect(startDeepDive).toHaveBeenCalledWith({ type: "label", name: "[Label A]", showDate: "2026-10-30" });
    expect(push).toHaveBeenCalledWith("/research/rj-deep01");
  });

  it("no show date is sent when none is picked; an empty name cannot start", async () => {
    results["research.list"] = [];
    render(<PlanPage />);
    expect(screen.getByRole("button", { name: "Start deep dive" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "[Artist A]" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start deep dive" })));
    expect(startDeepDive).toHaveBeenCalledWith({ type: "artist", name: "[Artist A]" });
  });

  it("a refused start says why", async () => {
    results["research.list"] = [];
    startDeepDive.mockRejectedValueOnce({ data: { code: "BAD_INPUT", message: "That's the closing track of hour 1. Closing tracks are never researched." } });
    render(<PlanPage />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "[Artist C]" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start deep dive" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Closing tracks are never researched.");
    expect(push).not.toHaveBeenCalled();
  });

  it("the research list, newest first, each row linking to its page", () => {
    results["research.list"] = [
      { jobId: "rj-new001", kind: "deep-dive", subject: { type: "artist", name: "[Artist A]" }, status: "running", createdAt: 3, updatedAt: 3 },
      { jobId: "rj-old001", kind: "show-notes", showDate: "2026-10-30", status: "done", createdAt: 1, updatedAt: 2 },
    ];
    render(<PlanPage />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/research/rj-new001", "/research/rj-old001"]);
    expect(links[0]).toHaveTextContent("Deep dive: [Artist A]");
    expect(links[1]).toHaveTextContent("Show notes, 10.30.26");
    expect(links[1]).toHaveTextContent("Done");
  });

  it("nothing researched yet", () => {
    results["research.list"] = [];
    render(<PlanPage />);
    expect(screen.getByText("Nothing researched yet.")).toBeInTheDocument();
  });
});
