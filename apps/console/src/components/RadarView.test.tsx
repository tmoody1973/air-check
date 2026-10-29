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
const acts = (): RadarActions => ({ setStatus: vi.fn(noop), edit: vi.fn(noop), setEmbargo: vi.fn(noop), retry: vi.fn(noop), retryEmbed: vi.fn(noop) });

function setup({ tab = "bandcamp" as "bandcamp" | "cosign", workspace = "real" as "real" | "demo", layout = "table" as "table" | "cards", data = lists, notAdded = [] as never[] } = {}) {
  const onTabChange = vi.fn();
  const actions = acts();
  const view = render(<RadarView lists={data} tab={tab} onTabChange={onTabChange} workspace={workspace} today="2026-10-30" actions={actions} notAdded={notAdded} layout={layout} />);
  return { onTabChange, actions, ...view };
}
const visibleArtists = () => screen.queryAllByText(/^Artist [bc]\d$/).map((e) => e.textContent);

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

describe("grouping", () => {
  it("Bandcamp groups by Label (default), Genre or Release date, with [No label] and [Date not known]", () => {
    setup();
    const select = screen.getByLabelText("Group by") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Label", "Genre", "Release date"]);
    expect(select.value).toBe("label");
    const groups = () => screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(groups()).toEqual(["Alpha1", "Zed Records1", "[No label]1"]);
    fireEvent.change(select, { target: { value: "genre" } });
    expect(groups()).toEqual(["Jazz2", "Soul1"]);
    fireEvent.change(select, { target: { value: "date" } });
    expect(groups()).toEqual(["Nov 1, 20261", "Nov 14, 20261", "[Date not known]1"]);
  });

  it("Co-signs groups by Label or Release date and shows the sender and the embargo pill", () => {
    setup({ tab: "cosign" });
    const select = screen.getByLabelText("Group by") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Label", "Release date"]);
    expect(screen.getByText("Label PR Co")).toBeInTheDocument();
    expect(screen.getByText("Embargoed · date not known")).toBeInTheDocument();
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
    expect(screen.getByText("[Bandcamp player]")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Not added" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Consider" }));
    await waitFor(() => expect(actions.setStatus).toHaveBeenCalledWith({ releaseId: "d1", status: "considering" }));
  });

  it("loading and not allowed", () => {
    const { rerender } = setup({ data: { bandcamp: undefined, cosign: undefined } });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<RadarView lists={{ bandcamp: null, cosign: null }} tab="bandcamp" onTabChange={vi.fn()} workspace="real" today="2026-10-30" actions={acts()} notAdded={[]} />);
    expect(screen.getByText("This account can't use Air Check. Sign in with your Radio Milwaukee account.")).toBeInTheDocument();
  });

  it("an empty tab says what will land there", () => {
    setup({ data: { bandcamp: list([]), cosign: list([]) } });
    expect(screen.getByText(/Bandcamp's new-release emails land here/)).toBeInTheDocument();
  });
});

describe("phone", () => {
  it("stacked cards: no table, the same tabs, chips, controls and player", () => {
    setup({ layout: "cards", data: { ...lists, bandcamp: list([rel("b1", { bandcampPage: "https://a.bandcamp.com/album/x", embed: { kind: "album", id: "1" }, embedState: "ready" })]) } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
    const card = screen.getByRole("listitem", { name: "Artist b1 – Title b1" });
    for (const name of ["Consider", "Played", "Pass", "Edit", "Play on Bandcamp"]) expect(within(card).getByRole("button", { name })).toBeInTheDocument();
  });
});
