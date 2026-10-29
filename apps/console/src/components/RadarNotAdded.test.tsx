// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkExtraction, senderDecision } from "@aircheck/core";
import { RadarNotAdded, type NotAddedRow } from "./RadarNotAdded";

afterEach(cleanup);

const AT = Date.UTC(2026, 9, 29, 14, 5);
const row = (over: Partial<NotAddedRow>): NotAddedRow => ({ messageId: "m", receivedAt: AT, from: "Someone <someone@label.example>", subject: "New single", state: "refused", reasons: [], ...over });

// The reasons exactly as they are stored, taken from the code that writes them where it is exported, so a wording
// change there fails here. Core: senderDecision (the inbound route's ignoredReason) and checkExtraction (refused).
const denied = (allowlist: string[]) => {
  const d = senderDecision({ from: "Promo <promo@label.example>", text: "" }, allowlist, null);
  if (d.ok) throw new Error("expected a refusal");
  return d.reason;
};
const NOT_LISTED = denied([]);
const NOT_CONFIRMED = denied(["promo@label.example"]);
const refusal = checkExtraction({ artist: "Nova", title: "Low Tide" }, "Low Tide is out on Friday", 0);
const REFUSED = refusal.ok || !("reasons" in refusal) ? "" : refusal.reasons[0]!;
// apps/ingest/src/radar.ts keeps these private; copied exactly.
const INGEST_NOT_A_RELEASE = "The reader found no release in this email";
const INGEST_NO_ANSWER = "The reader gave no answer";

const SHOWN: [NotAddedRow["state"], string, string][] = [
  ["ignored", NOT_LISTED, "Sender not on the list. To accept their mail, add the address to Air Check's sender list."],
  ["ignored", NOT_CONFIRMED, "AgentMail could not confirm the sender, so Air Check did not read it."],
  // Rows stored before ruling R12 keep their old reason, shown as stored.
  ["ignored", "Air Check's sender check is not set up", "Air Check's sender check is not set up"],
  ["not-a-release", INGEST_NOT_A_RELEASE, "Not a release email."],
  ["refused", REFUSED, "Couldn't read it: The artist is not in the email."],
  ["failed", INGEST_NO_ANSWER, "Couldn't read it: The reader gave no answer."],
];

describe("Not added", () => {
  it("the stored reasons are what the code writes today", () => {
    expect([NOT_LISTED, NOT_CONFIRMED, REFUSED]).toEqual([
      "Sender not on the list",
      "AgentMail could not confirm the sender",
      "The artist is not in the email",
    ]);
  });

  it("each row shows its time, sender, subject and the reason in plain words", () => {
    render(<RadarNotAdded rows={SHOWN.map(([state, reason], i) => row({ messageId: `m${i}`, state, reasons: [reason] }))} retry={vi.fn()} announce={vi.fn()} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(SHOWN.length);
    for (const [i, [, , shown]] of SHOWN.entries()) {
      expect(within(items[i]!).getByText(shown)).toBeInTheDocument();
      expect(within(items[i]!).getByText("Someone <someone@label.example>")).toBeInTheDocument();
      expect(within(items[i]!).getByText("New single")).toBeInTheDocument();
      expect(within(items[i]!).getByText(/Oct 29, 2026/)).toBeInTheDocument();
    }
    expect(screen.queryByText(/RADAR_SENDERS/)).toBeNull();
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
