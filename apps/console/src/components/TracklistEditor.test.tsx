// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TracklistEditor, type DraftFn } from "./TracklistEditor";

afterEach(cleanup);

const GOLDEN = readFileSync(resolve(import.meta.dirname, "../../../../fixtures/raw/10-2-26-drive-tracklist.txt"), "utf8");
const ONE_HOUR = "HOUR 1\nA - \"One\"\nB - \"Two\"";
const draftOk = (): DraftFn => vi.fn(async () => ({ runId: "run42" }));

function setup(over: Partial<React.ComponentProps<typeof TracklistEditor>> = {}) {
  const draft = draftOk();
  const onDone = vi.fn();
  render(<TracklistEditor draft={draft} onDone={onDone} {...over} />);
  return { draft, onDone };
}
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = () => screen.getByRole("button", { name: /draft package|drafting/i });

describe("TracklistEditor", () => {
  it("parses live and marks the two closing tracks of the golden tracklist", () => {
    setup();
    type("Tracklist", GOLDEN);
    expect(screen.getAllByText("closing track")).toHaveLength(2);
    expect(screen.getByText(/Hour 1: 15 tracks/)).toBeInTheDocument();
    expect(screen.getByText(/Hour 2: 16 tracks/)).toBeInTheDocument();
  });

  it("is disabled with only hour 1", () => {
    setup();
    type("Show date", "2026-10-02");
    type("Tracklist", ONE_HOUR);
    expect(button()).toBeDisabled();
    expect(screen.getByText(/Hour 2 has no tracks yet/)).toBeInTheDocument();
  });

  it("is disabled and flags an unparseable line", () => {
    setup();
    type("Show date", "2026-10-02");
    type("Tracklist", `${GOLDEN}\nthis line has no separator`);
    expect(button()).toBeDisabled();
    const flag = screen.getByText("this line has no separator").closest("li")!;
    expect(within(flag).getByText(/Artist - Title/)).toBeInTheDocument();
    expect(screen.getByText(/1 line to fix/)).toBeInTheDocument();
  });

  it("is enabled once date and both hours are good", () => {
    setup();
    expect(button()).toBeDisabled();
    type("Tracklist", GOLDEN);
    expect(button()).toBeDisabled(); // no date
    type("Show date", "2026-10-02");
    expect(button()).toBeEnabled();
  });

  it("submits the three fields and hands back the run id", async () => {
    const { draft, onDone } = setup();
    type("Show date", "2026-10-02");
    type("Tracklist", GOLDEN);
    type(/Private notes/, "Ask about the Bishop reissue");
    fireEvent.click(button());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("run42"));
    expect(draft).toHaveBeenCalledWith({ showDate: "2026-10-02", tracklistText: GOLDEN, notes: "Ask about the Bishop reissue" });
  });

  it("a double click sends one call", async () => {
    const { draft, onDone } = setup();
    type("Show date", "2026-10-02");
    type("Tracklist", GOLDEN);
    fireEvent.click(button());
    fireEvent.click(button());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(draft).toHaveBeenCalledOnce();
  });

  it("prefills from initial", () => {
    setup({ initial: { showDate: "2026-09-25", tracklistText: GOLDEN, notes: "n" } });
    expect(screen.getByLabelText("Show date")).toHaveValue("2026-09-25");
    expect(screen.getByLabelText("Tracklist")).toHaveValue(GOLDEN);
    expect(screen.getByLabelText(/Private notes/)).toHaveValue("n");
  });

  it("shows a quiet note when the earlier draft could not be loaded", () => {
    setup({ loadFailed: true });
    expect(screen.getByText("That draft couldn't be loaded.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tracklist")).toHaveValue("");
  });

  it("disables Draft over the character limits and shows a count", () => {
    setup();
    type("Show date", "2026-10-02");
    type("Tracklist", GOLDEN);
    expect(screen.queryByText(/characters/)).not.toBeInTheDocument();
    type(/Private notes/, "x".repeat(20_001));
    expect(button()).toBeDisabled();
    expect(screen.getByText(/20,001 \/ 20,000/)).toBeInTheDocument();
  });

  describe("errors in plain words", () => {
    const cases: [string, unknown, string][] = [
      ["RATE_LIMITED", new ConvexError({ code: "RATE_LIMITED" }), "Demo limit reached. Try again in a few minutes."],
      ["INVALID_INPUT", new ConvexError({ code: "INVALID_INPUT" }), "Check the date and the tracklist."],
      ["UNAUTHENTICATED", new ConvexError({ code: "UNAUTHENTICATED" }), "Signing you in… try again in a moment."],
      ["a generic Error", new Error("[CONVEX M(tracklist:draft)] Server Error boom"), "Couldn't start the draft. Please try again."],
      ["a prototype key", new ConvexError({ code: "constructor" }), "Couldn't start the draft. Please try again."],
    ];
    it.each(cases)("%s", async (_n, err, text) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { onDone } = setup({ draft: vi.fn(async () => { throw err; }) });
      type("Show date", "2026-10-02");
      type("Tracklist", GOLDEN);
      fireEvent.click(button());
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.getByRole("alert").textContent).not.toMatch(/CONVEX|boom|RATE_LIMITED|INVALID_INPUT/);
      expect(onDone).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
      expect(button()).toBeEnabled(); // can retry
      spy.mockRestore();
    });
  });

  it("keeps Draft package disabled with a hint until sign-in is ready", () => {
    const { draft } = setup({ authReady: false });
    type("Show date", "2026-10-02");
    type("Tracklist", GOLDEN);
    expect(button()).toBeDisabled();
    expect(screen.getByText("Signing you in…")).toBeInTheDocument();
    expect(draft).not.toHaveBeenCalled();
  });

  it("enables Draft package once sign-in is ready", () => {
    setup({ authReady: true });
    type("Show date", "2026-10-02");
    type("Tracklist", GOLDEN);
    expect(button()).toBeEnabled();
    expect(screen.queryByText("Signing you in…")).not.toBeInTheDocument();
  });
});
