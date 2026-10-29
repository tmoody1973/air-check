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
  const summary = { awaiting: [], openClaims: [], releases: { count: 0, labels: [], items: [], embargoed: { bandcamp: 0, cosign: 0 }, byTab: { bandcamp: 0, cosign: 0 } }, blockedSince: 0 };
  const ep = (status: string) => ({ status });

  it("links to Episodes with the count still to clear", () => {
    results["today.summary"] = summary;
    results["episodes.list"] = { episodes: [ep("published"), ep("rerun"), ep("question"), ep("ready-to-draft")], awaitingReview: 0 };
    render(<TodayPage />);
    expect(screen.getByRole("link", { name: "Backlog: 2 shows to go" })).toHaveAttribute("href", "/episodes");
  });

  it("no line when Episodes is not available (demo or not staff)", () => {
    results["today.summary"] = summary;
    render(<TodayPage />);
    expect(screen.queryByRole("link", { name: /Backlog:/ })).not.toBeInTheDocument();
  });
});

describe("Today release radar card", () => {
  const releases = {
    count: 4,
    labels: ["Night Shift"],
    // The server sends Bandcamp items only (fix round 1).
    items: [{ artist: "Nova Reyes", title: "Low Tide", label: "Night Shift", type: "album", tab: "bandcamp" }],
    embargoed: { bandcamp: 1, cosign: 2 },
    byTab: { bandcamp: 2, cosign: 2 },
  };
  const summary = { awaiting: [], openClaims: [], releases, blockedSince: 0 };

  it("counts only new Bandcamp-tab records and links to the radar", () => {
    results["today.summary"] = summary;
    render(<TodayPage />);
    const card = screen.getByRole("heading", { name: "New Bandcamp releases" }).closest("section")!;
    expect(card).toHaveTextContent("2 new");
    expect(card).toHaveTextContent("Nova Reyes · Low Tide");
    expect(screen.getByRole("link", { name: "Open release radar" })).toHaveAttribute("href", "/release-radar");
  });

  it("a second line counts new co-signs and opens that tab", () => {
    results["today.summary"] = summary;
    render(<TodayPage />);
    expect(screen.getByRole("link", { name: "2 new co-signs" })).toHaveAttribute("href", "/release-radar?tab=cosign");
  });

  it("embargoed items show their pill per tab, each under its own line, never named", () => {
    results["today.summary"] = summary;
    render(<TodayPage />);
    const bandcamp = screen.getByText(/1 new Bandcamp release is embargoed/);
    expect(bandcamp.querySelector(".bg-caution-bg")).toHaveTextContent("Embargoed");
    const cosign = screen.getByRole("link", { name: "2 new co-signs" }).closest("p")!;
    expect(cosign.querySelector(".bg-caution-bg")).toHaveTextContent("2 embargoed");
  });

  it("no embargo pill when nothing is embargoed", () => {
    results["today.summary"] = { ...summary, releases: { ...releases, embargoed: { bandcamp: 0, cosign: 0 } } };
    render(<TodayPage />);
    expect(screen.queryByText(/Embargoed|embargoed/)).toBeNull();
  });
});
