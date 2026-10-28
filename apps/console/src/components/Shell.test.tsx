// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxChip } from "./SandboxChip";
import { SandboxChipProvider, Shell } from "./Shell";

vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({ children, redirectUrl }: { children: React.ReactElement; redirectUrl?: string }) => <span data-redirect={redirectUrl}>{children}</span>,
}));

afterEach(cleanup);

const LABELS = ["Today", "Chat", "Plan", "Tracklist", "Episodes", "Release radar", "Trust", "Skills and memory", "Settings"];

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

  it("sidebar has a Sign out control that returns to /sign-in", () => {
    render(<Shell title="Today" workspace="real" active="today">x</Shell>);
    const b = screen.getByRole("button", { name: "Sign out" });
    expect(b).toHaveClass("min-h-11");
    expect(b.parentElement).toHaveAttribute("data-redirect", "/sign-in");
  });

  it("demo footer shows only in demo workspace", () => {
    const { rerender } = render(<Shell title="Today" workspace="demo" active="today">x</Shell>);
    expect(screen.getByText(/Publishing to Mixcloud is switched off/)).toBeInTheDocument();
    expect(screen.getByText(/Chats here are visible to other visitors\./)).toBeInTheDocument();
    rerender(<Shell title="Today" workspace="real" active="today">x</Shell>);
    expect(screen.queryByText(/Publishing to Mixcloud/)).not.toBeInTheDocument();
  });

  it("header shows exactly one sandbox chip, from the provider, and no static claim", () => {
    render(
      <SandboxChipProvider value={<SandboxChip row={{ phase: "Ready", allowedHosts: 10, at: 1 }} now={1} />}>
        <Shell title="Today" workspace="real" active="today">x</Shell>
      </SandboxChipProvider>,
    );
    expect(screen.getAllByText(/^Sandbox /)).toHaveLength(1);
    expect(screen.getByText("Sandbox on · 10 hosts allowed")).toBeInTheDocument();
    expect(screen.queryByText("Sandbox on")).not.toBeInTheDocument();
    expect(screen.queryByText(/destinations allowed/)).not.toBeInTheDocument();
  });

  it("without a provider the chip says unknown, never on", () => {
    render(<Shell title="Today" workspace="real" active="today">x</Shell>);
    expect(screen.getByText("Sandbox status unknown")).toBeInTheDocument();
    expect(screen.queryByText(/destinations allowed/)).not.toBeInTheDocument();
  });
});

describe("Shell nav targets", () => {
  it("Tracklist links to the built screen, not /soon", () => {
    render(<Shell title="Today" workspace="real" active="today">x</Shell>);
    expect(within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("link", { name: "Tracklist" })).toHaveAttribute("href", "/tracklist");
  });
  it("Episodes links to the built backlog page", () => {
    render(<Shell title="Today" workspace="real" active="today">x</Shell>);
    expect(within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("link", { name: "Episodes" })).toHaveAttribute("href", "/episodes");
  });
});

describe("Shell chat links", () => {
  it("Chat and New conversation both open /chat", () => {
    render(<Shell title="Chat" workspace="real" active="chat">x</Shell>);
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: /New conversation/ })).toHaveAttribute("href", "/chat");
  });
});
