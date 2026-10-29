// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = { isSignedIn: false };
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth, SignOutButton: ({ children }: { children: React.ReactNode }) => children }));
const results: Record<string, unknown> = {};
vi.mock("convex/react", () => ({ useQuery: (name: string) => results[name] ?? null }));
vi.mock("../../../../convex/_generated/api", () => ({
  api: { today: { summary: "today.summary" }, media: { issues: "media.issues" }, episodes: { list: "episodes.list" } },
}));
vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWorkspace: () => "real",
}));

import TodayPage from "./page";

afterEach(() => {
  cleanup();
  for (const k of Object.keys(results)) delete results[k];
});

describe("Today when the summary is null", () => {
  it("signed out: asks to sign in", () => {
    auth.isSignedIn = false;
    render(<TodayPage />);
    expect(screen.getByText("Sign in to see what is waiting for you.")).toBeInTheDocument();
  });

  it("signed in but not allowed: says the account can't use Air Check", () => {
    auth.isSignedIn = true;
    render(<TodayPage />);
    expect(
      screen.getByText("This account can't use Air Check. Sign in with your Radio Milwaukee account."),
    ).toBeInTheDocument();
  });
});

describe("Today backlog line", () => {
  const summary = { awaiting: [], openClaims: [], releases: { count: 0, labels: [], items: [] }, blockedSince: 0 };
  const ep = (status: string) => ({ status });

  it("links to Episodes with the count still to clear", () => {
    results["today.summary"] = summary;
    results["episodes.list"] = { episodes: [ep("published"), ep("rerun"), ep("question"), ep("ready-to-draft")], awaitingReview: 0 };
    render(<TodayPage />);
    expect(screen.getByRole("link", { name: "2026 backlog: 2 shows to go" })).toHaveAttribute("href", "/episodes");
  });

  it("no line when Episodes is not available (demo or not staff)", () => {
    results["today.summary"] = summary;
    render(<TodayPage />);
    expect(screen.queryByRole("link", { name: /2026 backlog/ })).not.toBeInTheDocument();
  });
});
