// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";

afterEach(cleanup);

const LABELS = ["Today", "Chat", "Plan", "Tracklist", "Episodes", "Release radar", "Trust", "Skills and memory"];

describe("Shell", () => {
  it("nav order matches spec", () => {
    render(<Shell title="Today" workspace="real" active="today">x</Shell>);
    const links = within(screen.getByRole("navigation", { name: "Workspace" })).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(LABELS);
  });

  it("active item has aria-current", () => {
    render(<Shell title="Trust" workspace="real" active="trust">x</Shell>);
    const nav = within(screen.getByRole("navigation", { name: "Workspace" }));
    expect(nav.getByRole("link", { name: "Trust" })).toHaveAttribute("aria-current", "page");
    expect(nav.getAllByRole("link").filter((l) => l.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("demo footer shows only in demo workspace", () => {
    const { rerender } = render(<Shell title="Today" workspace="demo" active="today">x</Shell>);
    expect(screen.getByText(/Publishing to Mixcloud is switched off/)).toBeInTheDocument();
    rerender(<Shell title="Today" workspace="real" active="today">x</Shell>);
    expect(screen.queryByText(/Publishing to Mixcloud/)).not.toBeInTheDocument();
  });

  it("header shows sandbox pills", () => {
    render(<Shell title="Today" workspace="real" active="today">x</Shell>);
    expect(screen.getByText("Sandbox on")).toBeInTheDocument();
    expect(screen.getByText("4 destinations allowed")).toBeInTheDocument();
  });
});
