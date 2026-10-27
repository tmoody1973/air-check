// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline, chicagoTime, type ActivityRow, type TrustFilter } from "./Timeline";

afterEach(cleanup);

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  at: Date.UTC(2026, 9, 26, 5, 26, 10), kind: "action", title: "Did a thing", result: "done", ...over,
});
const ROWS: ActivityRow[] = [
  row({ kind: "waiting", title: "RLR ready", result: "needs_you" }),
  row({ kind: "network", title: "Agent ran curl", destination: "example.com", result: "blocked", reason: "Not on the allow-list" }),
  row({ kind: "network", title: "Model call", destination: "Nebius Token Factory", result: "allowed" }),
  row({ kind: "action", title: "Drafted package", result: "done" }),
  row({ kind: "network", title: "Contacted maker", destination: "portal.nousresearch.com", result: "blocked", reason: "Not on the allow-list" }),
];
const view = (filter: TrustFilter = "all", onFilterChange = vi.fn()) =>
  render(<Timeline rows={ROWS} filter={filter} onFilterChange={onFilterChange} />);

describe("Timeline", () => {
  it("blocked rows show reason and tinted row class", () => {
    view();
    const tr = screen.getByText("Agent ran curl").closest("tr")!;
    expect(tr.className).toContain("bg-problem-row");
    expect(within(tr).getByText("Blocked")).toBeInTheDocument();
    expect(within(tr).getByText("Not on the allow-list")).toBeInTheDocument();
    expect(screen.getByText("Drafted package").closest("tr")!.className).not.toContain("bg-problem-row");
  });

  it("filter selects chip and rows", () => {
    const onChange = vi.fn();
    view("blocked", onChange);
    expect(screen.getByRole("button", { name: /Blocked/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Agent ran curl")).toBeInTheDocument();
    expect(screen.queryByText("Model call")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Network/ }));
    expect(onChange).toHaveBeenCalledWith("network");
  });

  it("counts per chip match rows", () => {
    view();
    const count = (name: RegExp, n: string) =>
      expect(within(screen.getByRole("button", { name })).getByText(n)).toBeInTheDocument();
    count(/^All/, "5");
    count(/Waiting for you/, "1");
    count(/Agent actions/, "1");
    count(/Network/, "3");
    count(/Blocked/, "2");
  });

  it("shows plain empty text and formats Chicago time", () => {
    render(<Timeline rows={[]} filter="waiting" onFilterChange={() => {}} />);
    expect(screen.getByText("Nothing is waiting for you.")).toBeInTheDocument();
    expect(chicagoTime(Date.UTC(2026, 9, 26, 5, 26, 10))).toBe("00:26:10");
    expect(chicagoTime(Date.UTC(2026, 0, 5, 6, 0, 0))).toBe("00:00:00");
  });
});
