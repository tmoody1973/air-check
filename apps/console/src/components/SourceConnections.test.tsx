// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { SourceConnections, SourceNotice, sourceNoticeFrom } from "./SourceConnections";

afterEach(cleanup);

const card = (name: string) => screen.getByRole("region", { name });
function expectPostForm(region: HTMLElement, name: string, action: string) {
  const form = within(region).getByRole("button", { name }).closest("form");
  expect(form).toHaveAttribute("method", "post");
  expect(form).toHaveAttribute("action", action);
}
const row = (source: "box" | "google" | "dropbox", state: "connected" | "needs_reconnect" | "not_connected", extra = {}) => ({ source, state, checkedAt: 1, ...extra });

describe("SourceConnections", () => {
  it("nothing recorded yet: Google Drive and Dropbox offer Connect; Box is not configured and has no button", () => {
    render(<SourceConnections sources={[]} workspace="real" />);
    expect(within(card("Google Drive")).getByText("Not connected")).toBeInTheDocument();
    expectPostForm(card("Google Drive"), "Connect Google Drive", "/api/google/authorize");
    expectPostForm(card("Dropbox"), "Connect Dropbox", "/api/dropbox/authorize");
    expect(within(card("Google Drive")).queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(within(card("Box")).getByText("Not configured")).toBeInTheDocument();
    expect(within(card("Box")).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("connected: the account, Reconnect and Disconnect; Box connected via the server app", () => {
    render(
      <SourceConnections
        sources={[row("box", "connected"), row("google", "connected", { account: "tarik@radiomilwaukee.org" }), row("dropbox", "connected", { account: "Dropbox account" })]}
        workspace="real"
      />,
    );
    expect(within(card("Google Drive")).getByText("Connected as tarik@radiomilwaukee.org")).toBeInTheDocument();
    expectPostForm(card("Google Drive"), "Reconnect", "/api/google/authorize");
    expectPostForm(card("Google Drive"), "Disconnect", "/api/google/disconnect");
    expectPostForm(card("Dropbox"), "Disconnect", "/api/dropbox/disconnect");
    expect(within(card("Box")).getByText("Connected via server app")).toBeInTheDocument();
  });

  it("needs reconnect: says so in words, never shows the stored error code", () => {
    render(
      <SourceConnections
        sources={[row("google", "needs_reconnect", { lastError: "invalid_grant" }), row("box", "needs_reconnect", { lastError: "401" })]}
        workspace="real"
      />,
    );
    expect(within(card("Google Drive")).getByText("Reconnect needed: Google Drive stopped accepting the permission")).toBeInTheDocument();
    expectPostForm(card("Google Drive"), "Reconnect", "/api/google/authorize");
    expect(within(card("Box")).getByText("Sign-in failed: check the Box values in ingest.env")).toBeInTheDocument();
    expect(screen.queryByText(/invalid_grant|401/)).not.toBeInTheDocument();
  });

  it("demo: switched off, no buttons", () => {
    render(<SourceConnections sources={null} workspace="demo" />);
    expect(screen.getByText(/switched off in the demo workspace/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("loading: no buttons", () => {
    render(<SourceConnections sources={undefined} workspace="real" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("sourceNoticeFrom", () => {
  const q = (s: string) => sourceNoticeFrom(new URLSearchParams(s));
  it("reads the outcome the routes put in the URL", () => {
    expect(q("google=connected")).toEqual({ provider: "google", kind: "connected" });
    expect(q("dropbox=disconnected")).toEqual({ provider: "dropbox", kind: "disconnected" });
    expect(q("dropbox=error&reason=no_refresh")).toEqual({ provider: "dropbox", kind: "error", reason: "no_refresh" });
  });
  it("never echoes an unknown reason, and ignores other params", () => {
    expect(q("google=error&reason=<script>")).toEqual({ provider: "google", kind: "error", reason: "unknown" });
    expect(q("google=error&reason=toString")).toEqual({ provider: "google", kind: "error", reason: "unknown" });
    expect(q("mixcloud=connected")).toBeNull();
    expect(q("google=weird")).toBeNull();
  });
  it("renders in plain words", () => {
    const { rerender } = render(<SourceNotice notice={{ provider: "google", kind: "error", reason: "no_refresh" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Google Drive did not send a lasting key");
    rerender(<SourceNotice notice={{ provider: "dropbox", kind: "connected" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Dropbox is connected. Air Check can read it, not change it.");
  });
});
