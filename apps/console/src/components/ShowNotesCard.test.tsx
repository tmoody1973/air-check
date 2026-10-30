// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BlockActions, ExportBar, ShowNotesCard } from "./ShowNotesCard";
import { entry, notesView, TODAY } from "./research.fixture";

afterEach(cleanup);

const actions = (): BlockActions => ({
  edit: vi.fn(() => Promise.resolve()),
  setPrivate: vi.fn(() => Promise.resolve()),
  setNote: vi.fn(() => Promise.resolve()),
  regenerate: vi.fn(() => Promise.resolve()),
});
const blockOf = (key: string) => screen.getByText(key).closest("article")!;

describe("ShowNotesCard", () => {
  it("per hour: intro, threads and entries; supplied notes labelled; closing tracks get one line", () => {
    render(<ShowNotesCard view={notesView()} today={TODAY} actions={actions()} />);
    expect(screen.getByRole("heading", { name: "Hour 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hour 2" })).toBeInTheDocument();
    expect(screen.getByText("The hour moves from [Artist A] into older label cuts.")).toBeInTheDocument();
    expect(screen.getByText("[Artist A] and [Artist B] both recorded at [Studio].")).toBeInTheDocument();
    const a = blockOf("H1.1");
    expect(within(a).getByText("[Title A] is on [Label A].")).toBeInTheDocument();
    expect(within(a).getByText(/from your supplied notes, which I did not independently check/)).toBeInTheDocument();
    expect(within(a).getByText("[Label A]'s one-sheet calls it a late-night record.")).toBeInTheDocument();
    expect(within(a).getByText("What does [Producer] bring to the low end here?")).toBeInTheDocument();
    expect(within(blockOf("H1.4")).getByText("closing track, no notes")).toBeInTheDocument();
    expect(within(blockOf("H1.3")).getByText("Not researched yet.")).toBeInTheDocument();
  });

  it("each claim lists its sources as host links; [verify] claims show the code-written check", () => {
    render(<ShowNotesCard view={notesView()} today={TODAY} actions={actions()} />);
    const a = blockOf("H1.1");
    expect(within(a).getByRole("link", { name: "label-a.bandcamp.com" })).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(within(a).getByText(/Sources disagree: 2026-10-16 \(example.org\) vs 2026-10-23 \(discogs.com\)/)).toBeInTheDocument();
  });

  it("embargoed blocks are Private with Plan 8's wording; dated and date not known", () => {
    render(<ShowNotesCard view={notesView()} today={TODAY} actions={actions()} />);
    expect(within(blockOf("H1.2")).getByText("Private")).toBeInTheDocument();
    expect(within(blockOf("H1.2")).getByText("Embargoed until Nov 7")).toBeInTheDocument();
    expect(within(blockOf("H2.1")).getByText("Embargoed · date not known")).toBeInTheDocument();
    expect(within(blockOf("H1.1")).queryByText("Private")).not.toBeInTheDocument();
  });

  it("Edit opens an inline editor; the saved block reads Edited by you and shows his text", async () => {
    const a = actions();
    const { rerender } = render(<ShowNotesCard view={notesView()} today={TODAY} actions={a} />);
    fireEvent.click(within(blockOf("H1.1")).getByRole("button", { name: "Edit" }));
    const box = within(blockOf("H1.1")).getByRole("textbox", { name: "Edit H1.1" });
    fireEvent.change(box, { target: { value: "My own words." } });
    await act(async () => fireEvent.click(within(blockOf("H1.1")).getByRole("button", { name: "Save" })));
    expect(a.edit).toHaveBeenCalledWith("H1.1", "My own words.");

    const v = notesView();
    v.entries = v.entries.map((e) => (e.key === "H1.1" ? { ...e, edited: { text: "My own words.", at: 2 } } : e));
    rerender(<ShowNotesCard view={v} today={TODAY} actions={a} />);
    expect(within(blockOf("H1.1")).getByText("Edited by you")).toBeInTheDocument();
    expect(within(blockOf("H1.1")).getByText("My own words.")).toBeInTheDocument();
    expect(within(blockOf("H1.1")).queryByText("[Title A] is on [Label A].")).not.toBeInTheDocument();
  });

  it("Mark private and Add your note call their mutations", async () => {
    const a = actions();
    render(<ShowNotesCard view={notesView()} today={TODAY} actions={a} />);
    await act(async () => fireEvent.click(within(blockOf("H1.3")).getByRole("button", { name: "Mark private" })));
    expect(a.setPrivate).toHaveBeenCalledWith("H1.3", true);
    fireEvent.click(within(blockOf("H1.3")).getByRole("button", { name: "Add your note" }));
    fireEvent.change(within(blockOf("H1.3")).getByRole("textbox", { name: "Your note for H1.3" }), { target: { value: "Saw them live." } });
    await act(async () => fireEvent.click(within(blockOf("H1.3")).getByRole("button", { name: "Save note" })));
    expect(a.setNote).toHaveBeenCalledWith("H1.3", "Saw them live.");
  });

  it("Regenerate asks first when the block has his edits", async () => {
    const a = actions();
    const v = notesView({}, { status: "done" });
    v.entries = [...v.entries, entry("H1.3", { edited: { text: "Mine.", at: 2 } })];
    render(<ShowNotesCard view={v} today={TODAY} actions={a} />);
    await act(async () => fireEvent.click(within(blockOf("H1.2")).getByRole("button", { name: "Regenerate" })));
    expect(a.regenerate).toHaveBeenCalledWith("H1.2", false);
    fireEvent.click(within(blockOf("H1.3")).getByRole("button", { name: "Regenerate" }));
    expect(within(blockOf("H1.3")).getByText("This block has your edits. Regenerate anyway?")).toBeInTheDocument();
    expect(a.regenerate).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(within(blockOf("H1.3")).getByRole("button", { name: "Regenerate anyway" })));
    expect(a.regenerate).toHaveBeenLastCalledWith("H1.3", true);
  });

  it("the shared demo sample is read-only: no block controls", () => {
    render(<ShowNotesCard view={notesView({ sample: true }, { status: "done" })} today={TODAY} actions={actions()} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("no Regenerate while the job is running", () => {
    render(<ShowNotesCard view={notesView()} today={TODAY} actions={actions()} />);
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
  });
});

describe("ExportBar", () => {
  const writeText = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it("Copy for Paper puts the Markdown on the clipboard and announces it", async () => {
    render(<ExportBar markdown="# Rhythm Lab Radio 10.30.26" fileName="RLR-10-30-26-show-notes.md" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy for Paper" })));
    expect(writeText).toHaveBeenCalledWith("# Rhythm Lab Radio 10.30.26");
    expect(screen.getByRole("status")).toHaveTextContent("Copied. Paste it into Paper.");
  });

  it("Download saves RLR-<date>-show-notes.md", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<ExportBar markdown="# x" fileName="RLR-10-30-26-show-notes.md" />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe("RLR-10-30-26-show-notes.md");
    click.mockRestore();
  });

  it("disabled until the export has loaded", () => {
    render(<ExportBar markdown={undefined} fileName="f.md" />);
    expect(screen.getByRole("button", { name: "Copy for Paper" })).toBeDisabled();
  });
});
