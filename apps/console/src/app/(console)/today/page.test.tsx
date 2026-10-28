// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = { isSignedIn: false };
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth, SignOutButton: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("convex/react", () => ({ useQuery: () => null }));
vi.mock("../../../../convex/_generated/api", () => ({ api: { today: { summary: "today.summary" }, media: { issues: "media.issues" } } }));
vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWorkspace: () => "real",
}));

import TodayPage from "./page";

afterEach(cleanup);

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
