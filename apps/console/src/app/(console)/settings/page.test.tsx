// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const results: Record<string, unknown> = {};
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("convex/react", () => ({ useQuery: (name: string) => results[name] }));
vi.mock("../../../../convex/_generated/api", () => ({
  api: { mixcloud: { get: "mixcloud.get" }, episodes: { sources: "episodes.sources" }, research: { searchUsage: "research.searchUsage" } },
}));
vi.mock("@/components/Shell", () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, useWorkspace: () => "real" }));
vi.mock("@/components/MixcloudConnection", () => ({ MixcloudConnection: () => null, noticeFrom: () => undefined }));
vi.mock("@/components/SourceConnections", () => ({ SourceConnections: () => null, SourceNotice: () => null, sourceNoticeFrom: () => undefined }));

import SettingsPage from "./page";

afterEach(cleanup);

describe("Settings web search row (Plan 7)", () => {
  it("reads today's Tavily searches from research.searchUsage", () => {
    results["research.searchUsage"] = { used: 12, cap: 30 };
    render(<SettingsPage />);
    expect(screen.getByText("Web search (Tavily)")).toBeInTheDocument();
    expect(screen.getByText("12 of 30 searches used today")).toBeInTheDocument();
  });

  it("the demo shows its own cap", () => {
    results["research.searchUsage"] = { used: 1, cap: 10 };
    render(<SettingsPage />);
    expect(screen.getByText("1 of 10 searches used today")).toBeInTheDocument();
  });
});
