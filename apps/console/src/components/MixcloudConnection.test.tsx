// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { MixcloudConnection, noticeFrom } from "./MixcloudConnection";

afterEach(cleanup);

// Connect and Disconnect are same-origin POST forms (CSRF: a cross-site link can't start or end a connection).
function expectPostForm(name: string, action: string) {
  const form = screen.getByRole("button", { name }).closest("form");
  expect(form).toHaveAttribute("method", "post");
  expect(form).toHaveAttribute("action", action);
}

// 2026-10-28 03:00 UTC is still Oct 27 in Milwaukee.
const AT = Date.UTC(2026, 9, 28, 3, 0);

describe("MixcloudConnection", () => {
  it("connected: account and date, Reconnect and Disconnect", () => {
    render(<MixcloudConnection status={{ state: "connected", account: "rhythmlab", connectedAt: AT }} workspace="real" />);
    expect(screen.getByText("Connected as rhythmlab · since Oct 27, 2026")).toBeInTheDocument();
    expectPostForm("Reconnect", "/api/mixcloud/authorize");
    expectPostForm("Disconnect", "/api/mixcloud/disconnect");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("not connected: Connect only", () => {
    render(<MixcloudConnection status={{ state: "not_connected" }} workspace="real" />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expectPostForm("Connect Mixcloud", "/api/mixcloud/authorize");
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("needs reconnect: says why, offers Reconnect and Disconnect", () => {
    render(<MixcloudConnection status={{ state: "needs_reconnect", account: "rhythmlab", lastError: "invalid_token" }} workspace="real" />);
    expect(screen.getByText("Reconnect needed: Mixcloud says the permission was revoked")).toBeInTheDocument();
    expectPostForm("Reconnect", "/api/mixcloud/authorize");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByText(/invalid_token/)).not.toBeInTheDocument();
  });

  it("demo: publishing is off, no buttons", () => {
    render(<MixcloudConnection status={null} workspace="demo" />);
    expect(screen.getByText(/switched off in the demo workspace/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("loading shows no buttons", () => {
    render(<MixcloudConnection status={undefined} workspace="real" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the outcome of the last action", () => {
    const { rerender } = render(<MixcloudConnection status={{ state: "not_connected" }} workspace="real" notice={{ kind: "error", reason: "denied" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Mixcloud did not give access");
    rerender(<MixcloudConnection status={{ state: "connected", account: "a", connectedAt: AT }} workspace="real" notice={{ kind: "connected" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Mixcloud is connected.");
  });
});

describe("noticeFrom", () => {
  it.each([
    ["mixcloud=connected", { kind: "connected" }],
    ["mixcloud=disconnected", { kind: "disconnected" }],
    ["mixcloud=error&reason=write", { kind: "error", reason: "write" }],
    ["mixcloud=error&reason=<script>", { kind: "error", reason: "unknown" }],
    ["", null],
    ["mixcloud=whatever", null],
  ])("%s", (q, out) => expect(noticeFrom(new URLSearchParams(q))).toEqual(out));
});
