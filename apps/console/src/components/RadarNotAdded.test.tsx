// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadarNotAdded, type NotAddedRow } from "./RadarNotAdded";

afterEach(cleanup);

const AT = Date.UTC(2026, 9, 29, 14, 5);
const row = (over: Partial<NotAddedRow>): NotAddedRow => ({ messageId: "m", receivedAt: AT, from: "Someone <someone@label.example>", subject: "New single", state: "refused", reasons: [], ...over });

const REASONS = [
  ["ignored", "Sender not on the list. Add it to RADAR_SENDERS to accept their mail."],
  ["ignored", "Sender's signature (DKIM) did not pass."],
  ["not-a-release", "Not a release email."],
  ["refused", "Couldn't read it: The artist 'Nova' is not in the email."],
] as const;

describe("Not added", () => {
  it("each row shows its time, sender, subject and plain reason", () => {
    render(<RadarNotAdded rows={REASONS.map(([state, reason], i) => row({ messageId: `m${i}`, state, reasons: [reason] }))} retry={vi.fn()} announce={vi.fn()} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    for (const [i, [, reason]] of REASONS.entries()) {
      expect(within(items[i]!).getByText(reason)).toBeInTheDocument();
      expect(within(items[i]!).getByText("Someone <someone@label.example>")).toBeInTheDocument();
      expect(within(items[i]!).getByText("New single")).toBeInTheDocument();
      expect(within(items[i]!).getByText(/Oct 29, 2026/)).toBeInTheDocument();
    }
  });

  it("the raw From header is attacker text: plain text only, never a link", () => {
    const from = '<a href="https://evil.example">Label</a> https://evil.example <x@evil.example>';
    const { container } = render(<RadarNotAdded rows={[row({ from })]} retry={vi.fn()} announce={vi.fn()} />);
    expect(screen.getByText(from)).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
  });

  it("an email waiting over 10 minutes says the ingest worker may be down", () => {
    render(<RadarNotAdded rows={[row({ state: "received", reasons: ["Waiting to be read"] })]} retry={vi.fn()} announce={vi.fn()} />);
    expect(screen.getByText("Waiting to be read")).toBeInTheDocument();
    expect(screen.getByText(/the ingest worker may be down/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("refused and failed rows get Try again (radar.retry); ignored and not-a-release do not", async () => {
    const retry = vi.fn(async () => undefined);
    const rows = [row({ messageId: "a", state: "refused" }), row({ messageId: "b", state: "failed" }), row({ messageId: "c", state: "ignored" }), row({ messageId: "d", state: "not-a-release" })];
    render(<RadarNotAdded rows={rows} retry={retry} announce={vi.fn()} />);
    const buttons = screen.getAllByRole("button", { name: "Try again" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(retry).toHaveBeenCalledWith({ messageId: "b" }));
  });

  it("nothing to show: a quiet line", () => {
    render(<RadarNotAdded rows={[]} retry={vi.fn()} announce={vi.fn()} />);
    expect(screen.getByText("Every email so far made a record.")).toBeInTheDocument();
  });
});
