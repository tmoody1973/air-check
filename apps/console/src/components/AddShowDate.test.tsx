// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddShowActions } from "./AddShowDate";
import { EpisodesView, type EpisodeActions, type EpisodeRow } from "./EpisodesView";
import type { SourceStatus } from "./SourceConnections";

// "Add a 2025 show" on Episodes: a 2025 date joins the backlog only when Tarik adds it, after a Mixcloud duplicate
// check. Every button calls an injected action (a Convex mutation as the signed-in person, or the console's route).
afterEach(cleanup);

const noop = async () => undefined;
const episodeActions = { answer: noop, markRerun: noop, unmarkRerun: noop, setTracklist: noop, pick: noop, setHours: noop, useFolderDate: noop, clearCorrection: noop, place: noop, unplace: noop, tracklistText: async () => "" } as EpisodeActions;
const connected: SourceStatus[] = (["box", "google", "dropbox"] as const).map((source) => ({ source, state: "connected" }));
const row = (showDate: string): EpisodeRow => ({
  showDate, audio: { status: "ready" }, tracklist: { status: "found" }, notes: { status: "found" }, questions: [], status: "ready-to-draft", gaps: [], packageId: "pkg-x", packageStatus: "none", draftAttempts: 0,
});
const acts = (over: Partial<AddShowActions> = {}): AddShowActions => ({
  addShowDate: vi.fn(noop), removeShowDate: vi.fn(noop), postedShows: vi.fn(async () => []), ...over,
});

function setup({ added = [] as string[], a = acts(), episodes = [row("2026-01-02")], layout = "table" as "table" | "cards" } = {}) {
  render(<EpisodesView data={{ episodes, awaitingReview: 0 }} sources={connected} workspace="real" today="2026-01-02" actions={episodeActions} added={added} addActions={a} layout={layout} />);
  return a;
}
const section = () => screen.getByRole("region", { name: "Add a 2025 show" });
const pick = (date: string) => fireEvent.change(within(section()).getByLabelText("2025 Friday"), { target: { value: date } });
const click = (name: string) => act(async () => fireEvent.click(within(section()).getByRole("button", { name })));
const live = () => screen.getByRole("status");

describe("Add a 2025 show", () => {
  it("a date input limited to 2025; Save adds it and announces the rescan", async () => {
    const a = setup();
    const input = within(section()).getByLabelText("2025 Friday");
    expect(input).toHaveAttribute("min", "2025-01-01");
    expect(input).toHaveAttribute("max", "2025-12-31");
    expect(within(section()).getByRole("button", { name: "Save" })).toBeDisabled();
    pick("2025-12-26");
    await click("Save");
    expect(a.postedShows).toHaveBeenCalledTimes(1);
    expect(a.addShowDate).toHaveBeenCalledWith({ date: "2025-12-26" });
    expect(live()).toHaveTextContent("Added Dec 26, 2025. Checking Box, Drive and Paper in a minute or two.");
  });

  it("Mixcloud already has that date: warns with the name as plain text; Cancel saves nothing, Add anyway saves", async () => {
    const a = setup({ a: acts({ postedShows: vi.fn(async () => [{ date: "2025-07-18", name: "RLR 7.18.25 | <b>Moses</b>" }]) }) });
    pick("2025-07-18");
    await click("Save");
    expect(within(section()).getByText("Mixcloud already has a show for Jul 18, 2025: RLR 7.18.25 | <b>Moses</b>. Add it anyway?")).toBeInTheDocument();
    expect(section().querySelector("b")).toBeNull();
    expect(a.addShowDate).not.toHaveBeenCalled();
    await click("Cancel");
    expect(within(section()).queryByText(/Mixcloud already has/)).not.toBeInTheDocument();
    expect(a.addShowDate).not.toHaveBeenCalled();
    await click("Save");
    await click("Add anyway");
    expect(a.addShowDate).toHaveBeenCalledWith({ date: "2025-07-18" });
  });

  it("the lookup fails: saves without the warning and says it couldn't check", async () => {
    const a = setup({ a: acts({ postedShows: vi.fn(async () => null) }) });
    pick("2025-12-26");
    await click("Save");
    expect(a.addShowDate).toHaveBeenCalledWith({ date: "2025-12-26" });
    expect(within(section()).getByText("Couldn't check Mixcloud.")).toBeInTheDocument();
  });

  it("Convex's refusal is shown in its own plain words", async () => {
    setup({ a: acts({ addShowDate: vi.fn(async () => Promise.reject(new ConvexError({ code: "BAD_INPUT", message: "Rhythm Lab airs Fridays — pick a Friday" }))) }) });
    pick("2025-12-25");
    await click("Save");
    expect(within(section()).getByRole("alert")).toHaveTextContent("Rhythm Lab airs Fridays — pick a Friday");
  });

  it("lists added dates; Remove asks first, Keep backs out, Remove again removes", async () => {
    const a = setup({ added: ["2025-01-03", "2025-12-26"] });
    const item = within(section()).getByText("Dec 26, 2025").closest("li")!;
    await act(async () => fireEvent.click(within(item).getByRole("button", { name: "Remove" })));
    expect(a.removeShowDate).not.toHaveBeenCalled();
    expect(item).toHaveTextContent("Remove Dec 26, 2025 from the backlog?");
    await act(async () => fireEvent.click(within(item).getByRole("button", { name: "Keep" })));
    expect(within(item).queryByText(/from the backlog\?/)).not.toBeInTheDocument();
    await act(async () => fireEvent.click(within(item).getByRole("button", { name: "Remove" })));
    await act(async () => fireEvent.click(within(item).getByRole("button", { name: "Yes, remove" })));
    expect(a.removeShowDate).toHaveBeenCalledWith({ date: "2025-12-26" });
  });

  it("removing a drafted show is refused plainly", async () => {
    const frozen = "this show already has a package; change it on the package page";
    setup({ added: ["2025-12-26"], a: acts({ removeShowDate: vi.fn(async () => Promise.reject(new ConvexError({ code: "BAD_INPUT", message: frozen }))) }) });
    await click("Remove");
    await click("Yes, remove");
    expect(within(section()).getByRole("alert")).toHaveTextContent(frozen);
  });

  it("a removed date whose row stays says so, with no fix pill", () => {
    setup({ episodes: [{ ...row("2025-12-26"), status: "not-in-backlog", corrected: { fields: ["tracklist"], at: 1, stale: false }, rescanPending: true }] });
    expect(document.getElementById("ep-2025-12-26")).toHaveTextContent("Not in the backlog");
  });

  it("an added 2025 show sits in the normal table and the phone cards; no 2025 blank Fridays", () => {
    setup({ added: ["2025-12-26"], episodes: [row("2025-12-26"), row("2026-01-02")] });
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Dec 26, 2025", "Jan 2, 2026"]);
    cleanup();
    setup({ added: ["2025-12-26"], episodes: [row("2025-12-26"), row("2026-01-02")], layout: "cards" });
    expect(document.getElementById("ep-2025-12-26")).toBeInTheDocument();
    expect(section()).toBeInTheDocument();
  });
});
