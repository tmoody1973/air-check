// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadarView, type RadarLists } from "./RadarView";
import type { RadarActions, Release } from "./ReleaseItem";

afterEach(cleanup);

const rel = (id: string, over: Partial<Release> = {}): Release => ({
  _id: id, workspace: "real", artist: `Artist ${id}`, title: `Title ${id}`, status: "new", source: "bandcamp", ...over,
});
const counts = (rows: Release[]) => {
  const c = { new: 0, considering: 0, played: 0, passed: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
};
const list = (rows: Release[]) => ({ rows, counts: counts(rows) });
const BANDCAMP = [
  rel("b1", { label: "Zed Records", genre: "Jazz", releasedOn: "2026-11-14" }),
  rel("b2", { label: "Alpha", genre: "Soul" }),
  rel("b3", { genre: "Jazz", releasedOn: "2026-11-01" }),
  rel("b4", { label: "Alpha", status: "considering" }),
  rel("b5", { label: "Alpha", status: "passed" }),
];
const COSIGN = [
  rel("c1", { source: "cosign", label: "Label PR", embargo: { until: null }, senders: [{ name: "Label PR Co", messageId: "m", at: 1 }] }),
  rel("c2", { source: "cosign", status: "played" }),
];
const lists: RadarLists = { bandcamp: list(BANDCAMP), cosign: list(COSIGN) };
const noop = async () => undefined;
const acts = (): RadarActions => ({ setStatus: vi.fn(noop), edit: vi.fn(noop), setEmbargo: vi.fn(noop), retry: vi.fn(noop), retryEmbed: vi.fn(noop), pastePlayer: vi.fn(noop), setFavorite: vi.fn(noop) });

function setup({ tab = "bandcamp" as "bandcamp" | "cosign", workspace = "real" as "real" | "demo", data = lists, notAdded = [] as never[], search = "" } = {}) {
  const onTabChange = vi.fn();
  const onSearchChange = vi.fn();
  const actions = acts();
  const view = render(
    <RadarView lists={data} tab={tab} onTabChange={onTabChange} workspace={workspace} today="2026-10-30" actions={actions} notAdded={notAdded} search={search} onSearchChange={onSearchChange} />,
  );
  return { onTabChange, onSearchChange, actions, ...view };
}
/** The artists of the release blocks on screen, in order (each block is a listitem named "Artist – Title"). */
const visibleArtists = () =>
  screen.queryAllByRole("listitem").flatMap((li) => /^(Artist [bc]\d) – /.exec(li.getAttribute("aria-label") ?? "")?.[1] ?? []);

describe("tabs", () => {
  it("Bandcamp and Co-signs are real tabs, each with its count of new records", () => {
    setup();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Bandcamp3 new", "Co-signs1 new"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[0]!.id);
  });

  it("arrow keys, Home and End move between the tabs", () => {
    const { onTabChange } = setup();
    const [bandcamp] = screen.getAllByRole("tab");
    fireEvent.keyDown(bandcamp!, { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenLastCalledWith("cosign");
    fireEvent.keyDown(bandcamp!, { key: "ArrowLeft" });
    expect(onTabChange).toHaveBeenLastCalledWith("cosign");
    fireEvent.keyDown(bandcamp!, { key: "End" });
    expect(onTabChange).toHaveBeenLastCalledWith("cosign");
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    expect(onTabChange).toHaveBeenLastCalledWith("cosign");
  });

  it("status chips: New by default, then Considering, Played, Passed and All with counts", () => {
    setup();
    const chips = within(screen.getByRole("group", { name: "Status" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["New 3", "Considering 1", "Played 0", "Passed 1", "All 5"]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(visibleArtists().sort()).toEqual(["Artist b1", "Artist b2", "Artist b3"]);
    fireEvent.click(chips[1]!);
    expect(visibleArtists()).toEqual(["Artist b4"]);
    fireEvent.click(chips[4]!);
    expect(visibleArtists()).toHaveLength(5);
  });
});

// Listening-queue brief D: no table header and no group headers; one Sort control instead.
describe("sort", () => {
  const sortBox = () => screen.getByLabelText("Sort") as HTMLSelectElement;
  const SORTED = [
    rel("b1", { label: "Zed Records", releasedOn: "2026-11-14", receivedAt: 3 }),
    rel("b2", { label: "alpha", receivedAt: 5 }),
    rel("b3", { releasedOn: "2026-11-01", receivedAt: 1 }),
    rel("b4", { label: "Mango", releasedOn: "2026-11-01", receivedAt: 4 }),
    rel("b5", { status: "considering", releasedOn: "2026-12-01", receivedAt: 9 }),
    rel("b6", { status: "considering", receivedAt: 8 }),
    rel("b7", { status: "considering", releasedOn: "2026-11-02", receivedAt: 7 }),
  ];
  const data: RadarLists = { bandcamp: list(SORTED), cosign: list(COSIGN) };

  it("Newest received (default), Release date (soonest first, unknown last) or Label (A to Z, none last); no table or group headers", () => {
    setup({ data });
    expect([...sortBox().options].map((o) => o.text)).toEqual(["Newest received", "Release date", "Label"]);
    expect(sortBox().value).toBe("received");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("rowheader")).toHaveLength(0);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(visibleArtists()).toEqual(["Artist b2", "Artist b4", "Artist b1", "Artist b3"]);
    fireEvent.change(sortBox(), { target: { value: "date" } });
    expect(visibleArtists()).toEqual(["Artist b4", "Artist b3", "Artist b1", "Artist b2"]); // same day: newest email first
    fireEvent.change(sortBox(), { target: { value: "label" } });
    expect(visibleArtists()).toEqual(["Artist b2", "Artist b4", "Artist b1", "Artist b3"]);
  });

  it("Considering defaults to Release date (the crate for the next show); Tarik's choice holds across the other chips", () => {
    setup({ data });
    const chip = (name: RegExp) => fireEvent.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name }));
    fireEvent.change(sortBox(), { target: { value: "label" } });
    chip(/^Played/);
    expect(sortBox().value).toBe("label"); // kept between non-Considering chips
    chip(/^All/);
    expect(sortBox().value).toBe("label");
    chip(/^Considering/); // entering Considering resets to its default
    expect(sortBox().value).toBe("date");
    expect(visibleArtists()).toEqual(["Artist b7", "Artist b5", "Artist b6"]);
    fireEvent.change(sortBox(), { target: { value: "received" } });
    expect(visibleArtists()).toEqual(["Artist b5", "Artist b6", "Artist b7"]);
    chip(/^New/); // leaving Considering resets too
    expect(sortBox().value).toBe("received");
  });

  it("review fix 8: Favorites and Sort share one row (one flex row, spread apart)", () => {
    setup({ data });
    const row = screen.getByLabelText("Sort").closest("[data-favorites-sort]")!;
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("button", { name: /Favorites/ })).toBeInTheDocument();
    expect(row.className).toMatch(/flex/);
    expect(row.className).toMatch(/items-center/);
    expect(row.className).toMatch(/justify-between/);
  });

  it("All: each block names its status", () => {
    setup({ data });
    fireEvent.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: /^All/ }));
    expect(screen.getAllByText("Considering", { selector: "span" }).length).toBe(3);
  });

  it("Co-signs show the sender and the embargo pill", () => {
    setup({ tab: "cosign" });
    expect(screen.getByText("From Label PR Co")).toBeInTheDocument();
    expect(screen.getByText("Embargoed · date not known")).toBeInTheDocument();
  });
});

describe("players", () => {
  it("one open at a time: Play on another release closes the first", () => {
    const ready = (id: string) => rel(id, { bandcampPage: `https://${id}.bandcamp.com/album/x`, embed: { kind: "album", id: id === "b1" ? "1" : "2" }, embedState: "ready" });
    setup({ data: { bandcamp: list([ready("b1"), ready("b2")]), cosign: list([]) } });
    const [first, second] = screen.getAllByRole("button", { name: "Play" });
    fireEvent.click(first!);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    fireEvent.click(second!);
    const frames = document.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute("src")).toContain("album=2/");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
});

describe("workspaces", () => {
  it("real: the Not added list sits below both tabs", () => {
    setup({ notAdded: [{ messageId: "m", receivedAt: 1, from: "x", subject: "s", state: "ignored", reasons: ["Not a release email."] }] as never[] });
    expect(screen.getByRole("heading", { name: "Not added" })).toBeInTheDocument();
    expect(screen.getByText("Not a release email.")).toBeInTheDocument();
  });

  it("demo: sample rows with the Sample tag, actions work, and no Not added section", async () => {
    const demo: RadarLists = { bandcamp: list([rel("d1", { workspace: "demo", artist: "[Artist]", title: "[Release title]", label: "[Label]" })]), cosign: list([]) };
    const { actions } = setup({ workspace: "demo", data: demo, notAdded: [{ messageId: "m" }] as never[] });
    expect(screen.getAllByText("Sample").length).toBeGreaterThan(1);
    expect(screen.queryByText("[Bandcamp player]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByText("[Bandcamp player]")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Not added" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Consider" }));
    await waitFor(() => expect(actions.setStatus).toHaveBeenCalledWith({ releaseId: "d1", status: "considering" }));
  });

  it("loading and not allowed", () => {
    const { rerender } = setup({ data: { bandcamp: undefined, cosign: undefined } });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<RadarView lists={{ bandcamp: null, cosign: null }} tab="bandcamp" onTabChange={vi.fn()} workspace="real" today="2026-10-30" actions={acts()} notAdded={[]} search="" onSearchChange={vi.fn()} />);
    expect(screen.getByText("This account can't use Air Check. Sign in with your Radio Milwaukee account.")).toBeInTheDocument();
  });

  it("an empty tab says what will land there", () => {
    setup({ data: { bandcamp: list([]), cosign: list([]) } });
    expect(screen.getByText(/Bandcamp's new-release emails land here/)).toBeInTheDocument();
  });
});

describe("phone and desk share one list", () => {
  it("each release is one block with Play, Consider and Pass in its action row", () => {
    setup({ data: { ...lists, bandcamp: list([rel("b1", { bandcampPage: "https://a.bandcamp.com/album/x", embed: { kind: "album", id: "1" }, embedState: "ready" })]) } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("list", { name: "Releases" })).toBeInTheDocument();
    const block = screen.getByRole("listitem", { name: "Artist b1 – Title b1" });
    expect(within(within(block).getByRole("group", { name: "Actions" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Play", "Consider", "Pass", "More"]);
  });
});

// Plan 8 Task 6b: one search box, a Favorites filter and tag filtering, on both tabs.
describe("search, favorites and tags (Task 6b)", () => {
  const TAGGED = [
    rel("b1", { tags: ["deep house", "jazz"], favorite: true }),
    rel("b2", { tags: ["jazz"] }),
    rel("b3", { status: "considering", favorite: true }),
    rel("b4", {}),
  ];
  const data: RadarLists = { bandcamp: list(TAGGED), cosign: list(COSIGN) };
  const chip = (name: RegExp) => within(screen.getByRole("group", { name: "Filters" })).getByRole("button", { name });

  it("one labelled search box; typing asks the page to search", () => {
    const { onSearchChange } = setup({ data, search: "jaz" });
    const box = screen.getByRole("searchbox", { name: "Search" });
    expect(box).toHaveValue("jaz");
    expect(box).toHaveAttribute("placeholder", "Artist, title, label, tag or description");
    fireEvent.change(box, { target: { value: "jazz" } });
    expect(onSearchChange).toHaveBeenCalledWith("jazz");
  });

  it("a search with no results says so, naming what was searched", () => {
    setup({ data: { bandcamp: list([]), cosign: list([]) }, search: "zzz" });
    expect(screen.getByText("Nothing on this tab matches “zzz”.")).toBeInTheDocument();
  });

  it("Favorites narrows to starred releases; the status chips count within it", () => {
    setup({ data });
    expect(visibleArtists()).toEqual(["Artist b1", "Artist b2", "Artist b4"]);
    const fav = chip(/Favorites/);
    expect(fav).toHaveAttribute("aria-pressed", "false");
    expect(fav).toHaveTextContent("Favorites 2");
    fireEvent.click(fav);
    expect(fav).toHaveAttribute("aria-pressed", "true");
    expect(visibleArtists()).toEqual(["Artist b1"]);
    expect(chip(/^Considering/)).toHaveTextContent("Considering 1");
    fireEvent.click(chip(/^All/));
    expect(visibleArtists()).toEqual(["Artist b1", "Artist b3"]);
    fireEvent.click(chip(/Favorites/));
    expect(visibleArtists()).toEqual(["Artist b1", "Artist b2", "Artist b3", "Artist b4"]);
  });

  it("a tag chip filters by that tag; Clear tag undoes it", () => {
    setup({ data });
    fireEvent.click(screen.getAllByRole("button", { name: "deep house" })[0]!);
    expect(visibleArtists()).toEqual(["Artist b1"]);
    expect(screen.getByText("Tag: deep house")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear tag" }));
    expect(visibleArtists()).toEqual(["Artist b1", "Artist b2", "Artist b4"]);
  });

  it("the tag filter stays when the tab changes back and forth, and favorites hold too", () => {
    const view = setup({ data });
    fireEvent.click(screen.getAllByRole("button", { name: "jazz" })[0]!);
    expect(visibleArtists()).toEqual(["Artist b1", "Artist b2"]);
    view.rerender(<RadarView lists={data} tab="cosign" onTabChange={vi.fn()} workspace="real" today="2026-10-30" actions={acts()} notAdded={[]} search="" onSearchChange={vi.fn()} />);
    expect(screen.getByText("Nothing matches these filters.")).toBeInTheDocument();
  });
});
