// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PackageRecord, Track } from "@aircheck/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PackageDecision, type DecideFn } from "./PackageDecision";
import { PlayerProvider } from "./PlayerProvider";

afterEach(cleanup);

const track = (position: number, closing = false): Track => ({
  hour: closing ? 2 : 1, position, artist: `Artist ${position}`, title: `Song ${position}`, raw: "", closing,
});

function record(over: Partial<PackageRecord> = {}, draft: Partial<PackageRecord["draft"]> = {}): PackageRecord {
  return {
    status: "awaiting_review",
    fingerprint: "fp1",
    draft: {
      id: "p1", workspace: "real", showDate: "2026-10-02", title: "RLR 10.2.26 | Kiwanuka and more",
      tags: ["Jazz", "Soul"], description: "A show — café", tracks: [track(1), track(2, true), track(3, true)],
      audio: { hour1Id: "a", hour2Id: "b" }, flags: ["Spellings checked.", "Left out one detail."], alternates: ["Other title"],
      ...draft,
    },
    ...over,
  } as PackageRecord;
}

const ok: DecideFn = async () => ({ ok: true });
const setup = (rec: PackageRecord | null, decide: DecideFn = ok, workspace: "real" | "demo" = "real") =>
  render(<PlayerProvider><PackageDecision record={rec} workspace={workspace} decide={decide} /></PlayerProvider>);

describe("PackageDecision", () => {
  it("renders title, 3 counts and numbered flags", () => {
    setup(record());
    expect(screen.getByRole("heading", { name: "RLR 10.2.26 | Kiwanuka and more" })).toBeInTheDocument();
    expect(screen.getByText("Show of Oct 2, 2026")).toBeInTheDocument();
    expect(screen.getByText("Draft · 2 flags")).toBeInTheDocument();
    expect(screen.getByText("tracks").previousSibling).toHaveTextContent("3");
    expect(screen.getByText("closing tracks").previousSibling).toHaveTextContent("2");
    expect(screen.getByText("description chars").previousSibling).toHaveTextContent("13");
    expect(screen.getByText("Spellings checked.").parentElement).toHaveTextContent("1Spellings checked.");
    expect(screen.getByText("Left out one detail.").parentElement).toHaveTextContent("2Left out one detail.");
    expect(screen.getByText("This will be public on Mixcloud")).toBeInTheDocument();
  });

  it("closing-track chip uses the neutral chip class", () => {
    setup(record());
    fireEvent.click(screen.getByRole("button", { name: /See description and tracklist/ }));
    const chips = screen.getAllByText("closing track");
    expect(chips).toHaveLength(2);
    chips.forEach((c) => {
      expect(c.className).toContain("bg-chip");
      expect(c.className).not.toMatch(/signal|green/);
    });
    expect(screen.getByText(/13 characters/)).toBeInTheDocument();
    expect(screen.getByText("Other title")).toBeInTheDocument();
  });

  it("approve button disables while pending", async () => {
    let resolve!: (v: Awaited<ReturnType<DecideFn>>) => void;
    const decide: DecideFn = () => new Promise((r) => (resolve = r));
    setup(record(), decide);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("button", { name: "Approving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("aria-disabled", "true");
    await act(async () => resolve({ ok: true }));
    // still locked after success until the record shows the decided status
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
  });

  it("preparing_audio disables Approve and Skip and says why", () => {
    setup(record({ status: "preparing_audio", fingerprint: undefined }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
    expect(screen.getByText("The audio is still being prepared.")).toBeInTheDocument();
  });

  it("pins the reviewed package; a live change needs Reload and sends the pinned fingerprint", async () => {
    const decide = vi.fn<DecideFn>(async () => ({ ok: true }));
    const a = record({ fingerprint: "fpA" }, { title: "Title A" });
    const b = record({ fingerprint: "fpB" }, { title: "Title B" });
    const ui = (r: PackageRecord) => (
      <PlayerProvider><PackageDecision record={r} workspace="real" decide={decide} /></PlayerProvider>
    );
    const { rerender } = render(ui(a));
    rerender(ui(b));
    expect(screen.getByText("This package changed. Open the latest version.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Title A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByRole("heading", { name: "Title B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(decide).toHaveBeenCalledWith("approve", "fpB");
  });

  it("stale approve shows reload message", async () => {
    const decide: DecideFn = async () => ({ ok: false, code: "PACKAGE_CHANGED", message: "This package changed. Open the latest version." });
    setup(record(), decide);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("This package changed. Open the latest version.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("not-ready and other failures show a notice", async () => {
    const { unmount } = setup(record(), async () => ({ ok: false, code: "NOT_READY", message: "x" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("The audio is still being prepared.")).toBeInTheDocument();
    unmount();
    setup(record(), async () => ({ ok: false, code: "FORBIDDEN", message: "Sign in again." }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Sign in again.")).toBeInTheDocument();
  });

  it("null record shows not found and no title", () => {
    setup(null);
    expect(screen.getByText("Package not found")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("decided packages never offer Approve; preparing_audio disables it", () => {
    const { unmount } = setup(record({ status: "approved" }));
    expect(screen.getByText("Approved · queued")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    unmount();
    setup(record({ status: "preparing_audio", fingerprint: undefined }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("status pills and published link", () => {
    const { unmount } = setup(record({ status: "succeeded", result: { url: "https://mixcloud.com/x" } }));
    expect(screen.getByRole("link", { name: "Published" })).toHaveAttribute("href", "https://mixcloud.com/x");
    unmount();
    setup(record({ status: "outcome_unknown" }));
    expect(screen.getByText("Upload uncertain")).toBeInTheDocument();
  });

  it("demo shows Sample pill and notice instead of the public line", () => {
    setup(record({}, { workspace: "demo" }), ok, "demo");
    expect(screen.getByText("Sample")).toBeInTheDocument();
    expect(screen.getByText("Demo workspace · Sample data. Publishing to Mixcloud is switched off.")).toBeInTheDocument();
    expect(screen.queryByText("This will be public on Mixcloud")).not.toBeInTheDocument();
  });

  it("demo: approved pill says sample, and the demo notice stays after approval", async () => {
    const notice = "Demo workspace · Sample data. Publishing to Mixcloud is switched off.";
    const ui = (r: PackageRecord) => (
      <PlayerProvider><PackageDecision record={r} workspace="demo" decide={ok} /></PlayerProvider>
    );
    const { rerender } = render(ui(record({}, { workspace: "demo" })));
    expect(screen.getByText(notice)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Draft · 2 flags"); // let decide resolve
    rerender(ui(record({ status: "approved" }, { workspace: "demo" })));
    expect(screen.getByText("Approved · sample, not published")).toBeInTheDocument();
    expect(screen.getByText(notice)).toBeInTheDocument();
    expect(screen.queryByText("Approved · queued")).not.toBeInTheDocument();
  });

  it("a decided record follows the live record instead of freezing", () => {
    const ui = (r: PackageRecord) => (
      <PlayerProvider><PackageDecision record={r} workspace="real" decide={ok} /></PlayerProvider>
    );
    const { rerender } = render(ui(record({ status: "approved" }, { title: "Title A" })));
    rerender(ui(record({ status: "succeeded", result: { url: "https://mixcloud.com/x" } }, { title: "Title B" })));
    expect(screen.getByRole("heading", { name: "Title B" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Published" })).toBeInTheDocument();
  });
  it("not connected to Mixcloud: points to Settings next to Approve, and Approve stays enabled", () => {
    const ui = (needsMixcloud: boolean) => (
      <PlayerProvider><PackageDecision record={record()} workspace="real" decide={ok} needsMixcloud={needsMixcloud} /></PlayerProvider>
    );
    const { rerender } = render(ui(true));
    expect(screen.getByRole("link", { name: "Connect Mixcloud to publish" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    rerender(ui(false));
    expect(screen.queryByRole("link", { name: "Connect Mixcloud to publish" })).not.toBeInTheDocument();
  });
});
