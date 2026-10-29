// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EpisodeActions } from "./EpisodeControls";
import { TracklistFix } from "./TracklistFix";

afterEach(cleanup);

const GOOD = "Rhythm Lab 1-9-26\nHOUR 1\nDonald Byrd - \"Change\"\nB - \"Two\"\nHOUR 2\nC - \"Three\"";
const noop = async () => undefined;
const actions = (over: Partial<EpisodeActions> = {}): EpisodeActions => ({
  answer: vi.fn(noop), markRerun: vi.fn(noop), unmarkRerun: vi.fn(noop), retryDraft: vi.fn(noop),
  setTracklist: vi.fn(noop), pick: vi.fn(noop), setHours: vi.fn(noop), useFolderDate: vi.fn(noop), clearCorrection: vi.fn(noop),
  place: vi.fn(noop), unplace: vi.fn(noop), tracklistText: vi.fn(async () => GOOD.replace("Donald", "Donalyd")),
  ...over,
});

async function setup(acts = actions()) {
  const announce = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    render(<TracklistFix showDate="2026-01-09" ctx={{ actions: acts, announce, choices: [] }} onClose={onClose} />);
  });
  return { acts, announce, onClose, box: screen.getByLabelText("Tracklist for Jan 9, 2026") as HTMLTextAreaElement };
}
const save = () => screen.getByRole("button", { name: "Save tracklist" });

describe("TracklistFix", () => {
  it("is pre-filled from tracklistText, and a Drive title line above HOUR 1 is not a problem", async () => {
    const { acts, box } = await setup();
    expect(acts.tracklistText).toHaveBeenCalledWith("2026-01-09");
    expect(box.value).toContain("Donalyd Byrd");
    expect(screen.getByText(/Hour 1: 2 tracks · Hour 2: 1 track · 2 closing/)).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("checks lines live; Save is disabled while a line is bad or an hour is empty", async () => {
    const { box } = await setup();
    fireEvent.change(box, { target: { value: "HOUR 1\nno dash here\nHOUR 2\nC - \"Three\"" } });
    expect(screen.getByText("Needs “Artist - Title”")).toBeInTheDocument();
    expect(save()).toBeDisabled();
    fireEvent.change(box, { target: { value: "HOUR 1\nA - \"One\"" } });
    expect(screen.getByText("Hour 2 has no tracks yet.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
    fireEvent.change(box, { target: { value: GOOD } });
    expect(save()).toBeEnabled();
  });

  it("saves the text as typed, announces it and closes", async () => {
    const { acts, announce, onClose, box } = await setup();
    fireEvent.change(box, { target: { value: GOOD } });
    await act(async () => fireEvent.click(save()));
    expect(acts.setTracklist).toHaveBeenCalledWith({ showDate: "2026-01-09", text: GOOD });
    expect(announce).toHaveBeenCalledWith("Saved. Checking again in a minute or two.");
    expect(onClose).toHaveBeenCalled();
  });

  it("a refusal shows Convex's plain words (with line numbers) and stays open", async () => {
    const acts = actions({ setTracklist: vi.fn(async () => { throw new ConvexError({ code: "BAD_INPUT", message: "Line 4 needs “Artist - Title”." }); }) });
    const { onClose } = await setup(acts);
    await act(async () => fireEvent.click(save()));
    expect(screen.getByRole("alert")).toHaveTextContent("Line 4 needs “Artist - Title”.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel closes without saving; a failed load says so and starts empty", async () => {
    const acts = actions({ tracklistText: vi.fn(async () => { throw new Error("offline"); }) });
    const { onClose, box } = await setup(acts);
    expect(screen.getByText("The saved tracklist couldn't be loaded. You can type it here.")).toBeInTheDocument();
    expect(box.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(acts.setTracklist).not.toHaveBeenCalled();
  });
});
