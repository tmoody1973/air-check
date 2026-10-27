// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PackageRecord, Track } from "@aircheck/core";
import { afterEach, describe, expect, it } from "vitest";
import { ChatPackageCard } from "./ChatPackageCard";

afterEach(cleanup);

const t = (hour: 1 | 2, position: number, closing = false): Track => ({ hour, position, artist: "A", title: `T${position}`, raw: "", closing });
const record = (over: Partial<PackageRecord["draft"]> = {}): PackageRecord => ({
  status: "awaiting_review",
  draft: {
    id: "pkg1", workspace: "demo", showDate: "2026-10-02", title: "RLR 10.2.26 | Test",
    tags: ["Jazz", "Soul"], description: "d", tracks: [t(1, 1), t(1, 2, true), t(2, 1), t(2, 2), t(2, 3, true)],
    audio: { hour1Id: "a", hour2Id: "b" }, ...over,
  },
});

describe("ChatPackageCard", () => {
  it("shows title, tags and counts computed from the record", () => {
    render(<ChatPackageCard record={record()} packageId="pkg1" />);
    expect(screen.getByRole("heading", { name: "RLR 10.2.26 | Test" })).toBeInTheDocument();
    expect(screen.getByText("Jazz")).toBeInTheDocument();
    expect(screen.getByText("Soul")).toBeInTheDocument();
    expect(screen.getByText("tracks").previousElementSibling).toHaveTextContent("5");
    expect(screen.getByText("closing tracks").previousElementSibling).toHaveTextContent("2");
    expect(screen.getByText("tags").previousElementSibling).toHaveTextContent("2");
  });
  it("counts change with the record, nothing is hard-coded", () => {
    render(<ChatPackageCard record={record({ tags: [], tracks: [t(1, 1, true)] })} packageId="pkg1" />);
    expect(screen.getByText("tracks").previousElementSibling).toHaveTextContent("1");
    expect(screen.getByText("tags").previousElementSibling).toHaveTextContent("0");
  });
  it("lists flags only when there are some", () => {
    const { rerender } = render(<ChatPackageCard record={record({ flags: ["Check Lý Qua Dub"] })} packageId="pkg1" />);
    expect(screen.getByText("Check Lý Qua Dub")).toBeInTheDocument();
    rerender(<ChatPackageCard record={record()} packageId="pkg1" />);
    expect(screen.queryByText(/for your review/i)).not.toBeInTheDocument();
  });
  it("links to the package page and has no approve button", () => {
    render(<ChatPackageCard record={record()} packageId="pkg1" />);
    expect(screen.getByRole("link", { name: "Review full package" })).toHaveAttribute("href", "/packages/pkg1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/approve/i)).not.toBeInTheDocument();
  });
});
