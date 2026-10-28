// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PackageRecord, Track } from "@aircheck/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageDecision, type CoverChangeFn, type DecideFn, type DescriptionSaveFn, type PublishState } from "./PackageDecision";
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

  it("preparing_audio disables Approve and Skip and says what it waits for", () => {
    setup(record({ status: "preparing_audio", fingerprint: undefined }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
    const copy = "Building the MP3 from the inbox folder 2026-10-02. If that folder was removed, copy the two WAVs back.";
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === copy)).toBeInTheDocument();
    expect(screen.getByText("2026-10-02")).toHaveClass("font-mono"); // the folder name is data (Three Voices)
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
    const { unmount } = setup(record({ status: "succeeded", result: { url: "https://www.mixcloud.com/x" } }));
    expect(screen.getByRole("link", { name: "Published" })).toHaveAttribute("href", "https://www.mixcloud.com/x");
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
    rerender(ui(record({ status: "succeeded", result: { url: "https://www.mixcloud.com/x" } }, { title: "Title B" })));
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

// Task 6: the real MP3, the cover, and where an approved show stands in the Mixcloud queue.
const HASH = "ab".repeat(32);
const withAudio = (over: Partial<PackageRecord> = {}) =>
  record(over, { id: "pkg-10-2-26", audio: { hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: HASH, hour1DurationSec: 3612.5 } });
const connected: PublishState = { dayOffset: 0, mixcloudState: "connected", today: "2026-10-27" };
const real = (r: PackageRecord, more: Partial<Parameters<typeof PackageDecision>[0]> = {}) =>
  render(<PlayerProvider><PackageDecision record={r} workspace="real" decide={ok} {...more} /></PlayerProvider>);

describe("PackageDecision: the real MP3", () => {
  it("plays the prepared MP3 through the audio route; Jump to hour 2 seeks to the hour-1 length", () => {
    const { container } = real(withAudio());
    const audio = container.ownerDocument.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe(`/api/audio/pkg-10-2-26?v=${HASH.slice(0, 12)}`);
    fireEvent.click(screen.getByRole("button", { name: "Jump to hour 2" }));
    expect(audio.currentTime).toBe(3612.5);
  });

  it("demo keeps the bundled sample and never touches the audio route", () => {
    const { container } = render(
      <PlayerProvider><PackageDecision record={withAudio()} workspace="demo" decide={ok} /></PlayerProvider>,
    );
    expect(container.ownerDocument.querySelector("audio")!.getAttribute("src")).toBe("/demo/sample-hour.mp3");
  });
});

describe("PackageDecision: cover", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });
  const png = new File([new Uint8Array(10)], "cover.png", { type: "image/png" });

  it("while awaiting review: shows the standard cover; a new image is uploaded, re-fingerprints, and asks for review again", async () => {
    const decide = vi.fn<DecideFn>(async () => ({ ok: true }));
    const change = vi.fn<CoverChangeFn>(async () => ({ ok: true, record: withAudio({ fingerprint: "fp2" }) }));
    const ui = (r: PackageRecord) => (
      <PlayerProvider>
        <PackageDecision record={r} workspace="real" decide={decide} cover={{ url: "https://convex.example/std.jpg", change }} />
      </PlayerProvider>
    );
    const { rerender } = render(ui(withAudio()));
    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute("src", "https://convex.example/std.jpg");
    expect(screen.getByText("Standard cover")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Use a different image"), { target: { files: [png] } });
    expect(await screen.findByText("Changed: review again")).toBeInTheDocument();
    expect(change).toHaveBeenCalledWith(png);
    // Convex delivers the re-fingerprinted record; Approve sends the new fingerprint, not the old one.
    rerender(ui(withAudio({ fingerprint: "fp2" })));
    expect(screen.queryByText("This package changed. Open the latest version.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(decide).toHaveBeenCalledWith("approve", "fp2");
  });

  it("refuses a wrong type before uploading, and shows a refused change", async () => {
    const change = vi.fn<CoverChangeFn>(async () => ({ ok: false, message: "Something went wrong." }));
    real(withAudio(), { cover: { url: null, change } });
    expect(screen.getByText("No cover yet")).toBeInTheDocument();
    const input = screen.getByLabelText("Use a different image");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
    expect(await screen.findByText("Use a JPEG, PNG or WebP image.")).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [png] } });
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.queryByText("Changed: review again")).not.toBeInTheDocument();
  });

  it("after approval the cover is read-only", () => {
    real(withAudio({ status: "approved" }), { cover: { url: "https://convex.example/own.jpg", change: vi.fn() }, publish: connected });
    expect(screen.getByRole("img", { name: "Cover" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Use a different image")).not.toBeInTheDocument();
  });

  it("a custom cover is labelled as your image", () => {
    real(record({}, { coverStorageId: "st1" }), { cover: { url: "https://convex.example/own.jpg", change: vi.fn() } });
    expect(screen.getByText("Your image")).toBeInTheDocument();
  });
});

describe("PackageDecision: queue and receipt", () => {
  afterEach(() => vi.useRealTimers());

  it("approved and connected: posts today, or on a Milwaukee date (3 a day, oldest first)", () => {
    const { unmount } = real(withAudio({ status: "approved" }), { publish: connected });
    expect(screen.getByText("Queued: posts today")).toBeInTheDocument();
    unmount();
    real(withAudio({ status: "approved" }), { publish: { dayOffset: 2, mixcloudState: "connected", today: "2026-10-27" } });
    expect(screen.getByText("Queued: posts on Oct 29, 2026 (3 a day, oldest first)")).toBeInTheDocument();
  });

  it("the date comes from the day the server counted against, not the browser's clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
    real(withAudio({ status: "approved" }), { publish: { dayOffset: 5, mixcloudState: "connected", today: "2026-10-28" } });
    expect(screen.getByText("Queued: posts on Nov 2, 2026 (3 a day, oldest first)")).toBeInTheDocument();
  });

  it("approved but Mixcloud not connected: points to Settings instead of a date", () => {
    for (const mixcloudState of ["not_connected", "needs_reconnect"] as const) {
      const { unmount } = real(withAudio({ status: "approved" }), { publish: { dayOffset: 0, mixcloudState, today: "2026-10-27" } });
      expect(screen.getByRole("link", { name: "Connect Mixcloud to publish" })).toHaveAttribute("href", "/settings");
      expect(screen.queryByText("Queued: posts today")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("publishing: uploading", () => {
    real(withAudio({ status: "publishing" }), { publish: connected });
    expect(screen.getByText("Uploading to Mixcloud…")).toBeInTheDocument();
  });

  it("succeeded: a receipt with the Mixcloud link, the time and the fingerprint", () => {
    const url = "https://www.mixcloud.com/rhythmlab/rlr-10-2-26/";
    real(withAudio({ status: "succeeded", fingerprint: "0123456789abcdef0123", result: { url, at: "2026-10-28T03:04:00.000Z" } }));
    expect(screen.getByRole("link", { name: "Open on Mixcloud" })).toHaveAttribute("href", url);
    expect(screen.getByText(/^Oct 27, 2026, 10:04\sPM$/)).toBeInTheDocument();
    expect(screen.getByText("0123456789ab")).toHaveAttribute("title", "0123456789abcdef0123");
  });

  it("a receipt URL off www.mixcloud.com is shown as text, never a link", () => {
    real(withAudio({ status: "succeeded", result: { url: "javascript:alert(1)", at: "2026-10-28T03:04:00.000Z" } }));
    expect(screen.queryByRole("link", { name: "Open on Mixcloud" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Published" })).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("failed: the reason and a Reopen for review button; no promise of an Approve that isn't there", () => {
    real(withAudio({ status: "failed", result: { error: "Mixcloud refused the cover image", at: "2026-10-28T03:04:00.000Z" } }), { settle: settleFns() });
    expect(screen.getByText("Mixcloud refused the cover image")).toBeInTheDocument();
    expect(screen.getByText("Reopen to review again. You'll need to approve it again.")).toBeInTheDocument();
    expect(screen.queryByText("Approve again after fixing.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen for review" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("outcome unknown: check Mixcloud first, with a link to the account's uploads", () => {
    const { unmount } = real(withAudio({ status: "outcome_unknown" }), { mixcloudAccount: "rhythm lab" });
    expect(screen.getByText("We don't know if it posted. Check Mixcloud before doing anything.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your Mixcloud uploads" })).toHaveAttribute("href", "https://www.mixcloud.com/rhythm%20lab/");
    unmount();
    real(withAudio({ status: "outcome_unknown" }));
    expect(screen.getByText("We don't know if it posted. Check Mixcloud before doing anything.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Your Mixcloud uploads" })).not.toBeInTheDocument();
  });

  it("approved and paused by the cover: says why", () => {
    const { unmount } = real(withAudio({ status: "approved" }), { publish: { ...connected, lastError: "cover_unavailable" } });
    expect(screen.getByText("Queued: posts today")).toBeInTheDocument();
    expect(screen.getByText("Publishing is paused: the cover image couldn't be downloaded. It tries again on its own.")).toBeInTheDocument();
    unmount();
    real(withAudio({ status: "approved" }), { publish: { ...connected, lastError: "bad_cover" } });
    expect(screen.getByText("Publishing is paused: the standard cover isn't an image Mixcloud takes. Replace it to continue.")).toBeInTheDocument();
  });

  it("demo shows none of the queue states", () => {
    render(
      <PlayerProvider>
        <PackageDecision record={record({ status: "approved" }, { workspace: "demo" })} workspace="demo" decide={ok} publish={connected} />
      </PlayerProvider>,
    );
    expect(screen.queryByText(/Queued/)).not.toBeInTheDocument();
  });
});

// I2: a failed or uncertain upload is settled from the package page.
type Settle = NonNullable<Parameters<typeof PackageDecision>[0]["settle"]>;
function settleFns(over: Partial<Settle> = {}): Settle {
  return {
    reopen: vi.fn<Settle["reopen"]>(async () => ({ ok: true, record: withAudio({ status: "awaiting_review", fingerprint: "fp9" }) })),
    confirmPosted: vi.fn<Settle["confirmPosted"]>(async (url) => ({ ok: true, record: withAudio({ status: "succeeded", result: { url, at: "2026-10-28T03:04:00.000Z" } }) })),
    ...over,
  };
}

describe("PackageDecision: settling a failed or uncertain upload", () => {
  it("failed: Reopen for review goes back to review, and Approve works again with the new fingerprint", async () => {
    const settle = settleFns();
    const decide = vi.fn<DecideFn>(async () => ({ ok: true }));
    const ui = (r: PackageRecord) => (
      <PlayerProvider><PackageDecision record={r} workspace="real" decide={decide} settle={settle} /></PlayerProvider>
    );
    const { rerender } = render(ui(withAudio({ status: "failed", result: { error: "cover is not a usable image" } })));
    fireEvent.click(screen.getByRole("button", { name: "Reopen for review" }));
    expect(settle.reopen).toHaveBeenCalledTimes(1);
    rerender(ui(withAudio({ status: "awaiting_review", fingerprint: "fp9" })));
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(decide).toHaveBeenCalledWith("approve", "fp9");
  });

  it("after approving in this session, a later reopen still unlocks Approve", async () => {
    const settle = settleFns();
    const ui = (r: PackageRecord) => (
      <PlayerProvider><PackageDecision record={r} workspace="real" decide={ok} settle={settle} /></PlayerProvider>
    );
    const { rerender } = render(ui(withAudio()));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await act(async () => {});
    rerender(ui(withAudio({ status: "failed", result: { error: "cover is not a usable image" } })));
    fireEvent.click(screen.getByRole("button", { name: "Reopen for review" }));
    await act(async () => {});
    rerender(ui(withAudio({ status: "awaiting_review", fingerprint: "fp9" })));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("a refused reopen shows why, and the button comes back", async () => {
    const settle = settleFns({ reopen: vi.fn(async () => ({ ok: false as const, code: "FORBIDDEN" as const, message: "only a signed-in Radio Milwaukee user can do this" })) });
    real(withAudio({ status: "failed", result: { error: "x" } }), { settle });
    fireEvent.click(screen.getByRole("button", { name: "Reopen for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only a signed-in Radio Milwaukee user can do this");
    expect(screen.getByRole("button", { name: "Reopen for review" })).toBeEnabled();
  });

  it("outcome unknown: It's on Mixcloud takes the show's address, checked here before it is sent", async () => {
    const settle = settleFns();
    real(withAudio({ status: "outcome_unknown" }), { settle, mixcloudAccount: "rhythmlab" });
    expect(screen.getByText("We don't know if it posted. Check Mixcloud before doing anything.")).toBeInTheDocument();
    const input = screen.getByLabelText("Show address on Mixcloud");
    fireEvent.change(input, { target: { value: "https://evil.example/rlr" } });
    fireEvent.click(screen.getByRole("button", { name: "It's on Mixcloud" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Paste the show's address from Mixcloud. It starts with https://www.mixcloud.com/");
    expect(settle.confirmPosted).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  https://www.mixcloud.com/rhythmlab/rlr-10-2-26/ " } });
    fireEvent.click(screen.getByRole("button", { name: "It's on Mixcloud" }));
    expect(settle.confirmPosted).toHaveBeenCalledWith("https://www.mixcloud.com/rhythmlab/rlr-10-2-26/");
  });

  it("outcome unknown: It isn't — reopen sends it back to review", () => {
    const settle = settleFns();
    real(withAudio({ status: "outcome_unknown" }), { settle });
    fireEvent.click(screen.getByRole("button", { name: "It isn't — reopen" }));
    expect(settle.reopen).toHaveBeenCalledTimes(1);
  });

  it("without the settle actions (demo), no buttons are offered", () => {
    real(withAudio({ status: "outcome_unknown" }));
    expect(screen.queryByRole("button", { name: "It isn't — reopen" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Show address on Mixcloud")).not.toBeInTheDocument();
  });
});

describe("PackageDecision: audio failures rebuild the MP3", () => {
  it.each([
    ["audio_changed", "The MP3 changed after approval"],
    ["audio_missing", "The prepared MP3 is missing"],
  ])("%s: plain reason, and the reopen says it rebuilds the MP3", (error, reason) => {
    const settle = settleFns();
    real(withAudio({ status: "failed", result: { error } }), { settle });
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByText("Reopen and rebuild the MP3. You'll review and approve it again.")).toBeInTheDocument();
    expect(screen.queryByText("Reopen to review again. You'll need to approve it again.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reopen and rebuild the MP3" }));
    expect(settle.reopen).toHaveBeenCalledTimes(1);
  });

  it("other short codes read as plain sentences; anything else is shown as written", () => {
    const { unmount } = real(withAudio({ status: "failed", result: { error: "rate_limited" } }));
    expect(screen.getByText("Mixcloud asked us to slow down twice, so the upload was not sent")).toBeInTheDocument();
    unmount();
    const r2 = real(withAudio({ status: "failed", result: { error: "internal_error" } }));
    expect(screen.getByText("Something went wrong before the upload. Nothing was sent.")).toBeInTheDocument();
    r2.unmount();
    real(withAudio({ status: "failed", result: { error: "UploadLimitExceeded" } }));
    expect(screen.getByText("UploadLimitExceeded")).toBeInTheDocument();
  });
});

// Plan 5c: the host edits the public description before approving. Saving re-fingerprints, so Approve needs the new text.
describe("PackageDecision: edit description", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: /See description and tracklist/ }));
  const box = () => screen.getByRole("textbox", { name: "Description" });

  it("live count and plain-word issues before saving; Save re-fingerprints and asks for review again", async () => {
    const decide = vi.fn<DecideFn>(async () => ({ ok: true }));
    const save = vi.fn<DescriptionSaveFn>(async (text) => ({ ok: true, record: record({ fingerprint: "fp2" }, { description: text }) }));
    const ui = (r: PackageRecord) => (
      <PlayerProvider><PackageDecision record={r} workspace="real" decide={decide} editDescription={save} /></PlayerProvider>
    );
    const { rerender } = render(ui(record()));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    expect(box()).toHaveValue("A show — café");
    expect(screen.getByRole("button", { name: "Save description" })).toBeDisabled(); // nothing changed yet
    fireEvent.change(box(), { target: { value: "An upcoming record — 🎷" } });
    expect(screen.getByText("22 / 999")).toBeInTheDocument(); // code points, not UTF-16 units
    expect(screen.getByText('Description has a time-relative phrase: "upcoming"')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save description" })).toBeDisabled();
    fireEvent.change(box(), { target: { value: "Song 1, Song 2 and more, warm and patient." } });
    expect(screen.queryByText(/time-relative/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));
    expect(await screen.findByText("Changed: review again")).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith("Song 1, Song 2 and more, warm and patient.");
    expect(screen.queryByRole("textbox", { name: "Description" })).not.toBeInTheDocument();
    expect(screen.getByText("Song 1, Song 2 and more, warm and patient.")).toBeInTheDocument();
    // Convex delivers the re-fingerprinted record; Approve sends the new fingerprint.
    rerender(ui(record({ fingerprint: "fp2" }, { description: "Song 1, Song 2 and more, warm and patient." })));
    expect(screen.queryByText("This package changed. Open the latest version.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(decide).toHaveBeenCalledWith("approve", "fp2");
  });

  it("over 999 characters: the count turns to a problem and Save stays off", () => {
    real(record(), { editDescription: vi.fn() });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    fireEvent.change(box(), { target: { value: "é".repeat(1000) } });
    expect(screen.getByText("1000 / 999")).toHaveClass("text-problem-text");
    expect(screen.getByText(/must be under 1,000/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save description" })).toBeDisabled();
  });

  it("a refused save shows why and keeps the text; Cancel puts the description back", async () => {
    const save = vi.fn<DescriptionSaveFn>(async () => ({ ok: false, message: "description contains a private term" }));
    real(record(), { editDescription: save });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    fireEvent.change(box(), { target: { value: "Thanks to someone private." } });
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Description contains a private term");
    expect(box()).toHaveValue("Thanks to someone private.");
    expect(screen.queryByText("Changed: review again")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("A show — café")).toBeInTheDocument();
  });

  it("no edit after a decision, on a stale page, or without the edit action (demo)", () => {
    const { unmount } = real(withAudio({ status: "approved" }), { editDescription: vi.fn(), publish: connected });
    open();
    expect(screen.queryByRole("button", { name: "Edit description" })).not.toBeInTheDocument();
    unmount();
    const ui = (r: PackageRecord) => <PlayerProvider><PackageDecision record={r} workspace="real" decide={ok} editDescription={vi.fn()} /></PlayerProvider>;
    const stale = render(ui(record()));
    open();
    expect(screen.getByRole("button", { name: "Edit description" })).toBeInTheDocument();
    stale.rerender(ui(record({ fingerprint: "fpX" })));
    expect(screen.queryByRole("button", { name: "Edit description" })).not.toBeInTheDocument();
    stale.unmount();
    render(<PlayerProvider><PackageDecision record={record()} workspace="demo" decide={ok} /></PlayerProvider>);
    open();
    expect(screen.queryByRole("button", { name: "Edit description" })).not.toBeInTheDocument();
  });

  it("the private sources show under the description, marked not published", () => {
    real(record({}, { descriptionSources: [{ claim: "Played bass with Ezra Collective", source: "crate: musicbrainz artist lookup" }] }));
    open();
    expect(screen.getByText("Sources (not published)")).toBeInTheDocument();
    expect(screen.getByText("Played bass with Ezra Collective")).toBeInTheDocument();
    expect(screen.getByText("crate: musicbrainz artist lookup")).toBeInTheDocument();
  });

  it("no sources: no sources heading", () => {
    real(record());
    open();
    expect(screen.queryByText("Sources (not published)")).not.toBeInTheDocument();
  });
});

// Plan 5c Task 4: a show on Mixcloud shows its live description and the update flow; the package never changes.
describe("PackageDecision: the live description", () => {
  const updateFns = { propose: async () => ({ ok: true as const, replaced: false }), approve: async () => ({ ok: true as const }) };
  const published = withAudio({ status: "succeeded", result: { url: "https://www.mixcloud.com/rhythmlab/x/", at: "2026-10-28T03:04:00.000Z" } });
  const view = { live: { description: "Updated words, now live.", updatedAt: "2026-10-28T15:04:00.000Z" }, latest: null };

  it("succeeded: the update section, and the counts and disclosure follow the live description", () => {
    real(published, { descriptionUpdate: { view, fns: updateFns } });
    expect(screen.getByRole("heading", { name: "Description on Mixcloud" })).toBeInTheDocument();
    expect(screen.getByText("description chars").previousSibling).toHaveTextContent(String([...view.live.description].length));
    fireEvent.click(screen.getByRole("button", { name: /See description and tracklist/ }));
    expect(screen.getAllByText("Updated words, now live.").length).toBe(2);
  });

  it("not on Mixcloud, or the demo: no update section", () => {
    const { unmount } = real(withAudio({ status: "awaiting_review" }), { descriptionUpdate: { view, fns: updateFns } });
    expect(screen.queryByRole("heading", { name: "Description on Mixcloud" })).toBeNull();
    unmount();
    render(<PlayerProvider><PackageDecision record={published} workspace="demo" decide={ok} descriptionUpdate={{ view, fns: updateFns }} /></PlayerProvider>);
    expect(screen.queryByRole("heading", { name: "Description on Mixcloud" })).toBeNull();
  });
});
