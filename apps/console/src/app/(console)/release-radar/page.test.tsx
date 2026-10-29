// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = { search: "", replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace }),
}));
const empty = { rows: [], counts: { new: 0, considering: 0, played: 0, passed: 0 } };
const queries: { name: string; args: unknown }[] = [];
vi.mock("convex/react", () => ({
  useQuery: (name: string, args: unknown) => {
    queries.push({ name, args });
    return name === "radar.notAdded" ? [] : empty;
  },
  useMutation: () => vi.fn(),
}));
vi.mock("../../../../convex/_generated/api", () => ({
  api: { radar: { list: "radar.list", notAdded: "radar.notAdded", setStatus: "s", edit: "e", setEmbargo: "m", retry: "r", retryEmbed: "re" } },
}));
vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWorkspace: () => "real",
}));

import RadarPage from "./page";

afterEach(() => {
  cleanup();
  nav.replace.mockClear();
  queries.length = 0;
});

describe("Release radar page", () => {
  it("the tab is kept in the URL: ?tab=cosign opens Co-signs", () => {
    nav.search = "tab=cosign";
    render(<RadarPage />);
    expect(screen.getByRole("tab", { name: /Co-signs/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Bandcamp/ }));
    expect(nav.replace).toHaveBeenCalledWith("/release-radar");
  });

  it("Bandcamp is the default, and choosing Co-signs writes ?tab=cosign", () => {
    nav.search = "tab=nonsense";
    render(<RadarPage />);
    expect(screen.getByRole("tab", { name: /Bandcamp/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Co-signs/ }));
    expect(nav.replace).toHaveBeenCalledWith("/release-radar?tab=cosign");
  });

  it("asks for both tabs (for their counts) and the Not added list", () => {
    nav.search = "";
    render(<RadarPage />);
    expect(queries).toContainEqual({ name: "radar.list", args: { tab: "bandcamp" } });
    expect(queries).toContainEqual({ name: "radar.list", args: { tab: "cosign" } });
    expect(queries.some((q) => q.name === "radar.notAdded")).toBe(true);
  });
});
