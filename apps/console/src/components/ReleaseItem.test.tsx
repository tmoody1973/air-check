// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embargoLabel, ReleaseItem, type RadarActions, type Release, type ReleaseCtx } from "./ReleaseItem";

afterEach(cleanup);

const TODAY = "2026-10-30";
const rel = (over: Partial<Release> = {}): Release => ({
  _id: "r1",
  workspace: "real",
  artist: "Nova Reyes",
  title: "Low Tide",
  label: "Night Shift",
  genre: "Jazz",
  type: "album",
  releasedOn: "2026-11-14",
  status: "new",
  source: "bandcamp",
  senders: [{ name: "Bandcamp", address: "noreply@bandcamp.com", messageId: "m1", at: 1 }],
  ...over,
});
const noop = async () => undefined;
const acts = (over: Partial<RadarActions> = {}): RadarActions => ({
  setStatus: vi.fn(noop), edit: vi.fn(noop), setEmbargo: vi.fn(noop), retry: vi.fn(noop), retryEmbed: vi.fn(noop), setFavorite: vi.fn(noop), ...over,
});
function setup(r: Release, { layout = "card" as "card" | "row", actions = acts(), demo = false, tag = undefined as string | undefined } = {}) {
  const ctx: ReleaseCtx = { actions, announce: vi.fn(), today: TODAY, demo, tab: r.source ?? "bandcamp", tag, onTag: vi.fn() };
  if (layout === "card") render(<ul><ReleaseItem r={r} layout="card" ctx={ctx} /></ul>);
  else render(<table><tbody><ReleaseItem r={r} layout="row" ctx={ctx} /></tbody></table>);
  return { actions, ctx };
}

describe("a record shows", () => {
  it("artist, title, label, genre, type, release date and the sender's name", () => {
    setup(rel());
    expect(screen.getByText("Nova Reyes")).toBeInTheDocument();
    expect(screen.getByText("Low Tide")).toBeInTheDocument();
    expect(screen.getByText(/Night Shift/)).toBeInTheDocument();
    expect(screen.getByText(/Jazz/)).toBeInTheDocument();
    expect(screen.getByText(/Album/)).toBeInTheDocument();
    expect(screen.getByText(/Nov 14, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/From Bandcamp/)).toBeInTheDocument();
  });

  it("the same in the desktop table row", () => {
    setup(rel(), { layout: "row" });
    expect(screen.getByText("Nova Reyes")).toBeInTheDocument();
    expect(screen.getByText(/Night Shift/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Consider" })).toBeInTheDocument();
  });

  it("the embargo pill: dated, undated, and none once the date has come", () => {
    expect(embargoLabel({ until: "2026-11-07" }, TODAY)).toBe("Embargoed until Nov 7");
    expect(embargoLabel({ until: "2027-01-07" }, TODAY)).toBe("Embargoed until Jan 7, 2027");
    expect(embargoLabel({ until: null }, TODAY)).toBe("Embargoed · date not known");
    expect(embargoLabel({ until: "2026-10-30" }, TODAY)).toBeNull();
    expect(embargoLabel(undefined, TODAY)).toBeNull();
    setup(rel({ embargo: { until: "2026-11-07" } }));
    expect(screen.getByText("Embargoed until Nov 7")).toHaveClass("bg-caution-bg");
  });

  it("R5: a later email's embargo after Tarik cleared it is a quiet note, not a pill", () => {
    setup(rel({ laterEmbargoNotice: { at: 5, until: "2026-12-01" } }));
    expect(screen.getByText("A newer email mentions an embargo — you cleared it")).toBeInTheDocument();
    expect(screen.queryByText(/^Embargoed/)).toBeNull();
  });

  it("the sender is plain text, never a link, even when it looks like one", () => {
    setup(rel({ source: "cosign", senders: [{ name: "<a href=\"https://evil.example\">x</a> https://evil.example", messageId: "m", at: 1 }] }));
    expect(screen.getByText(/https:\/\/evil\.example/)).toBeInTheDocument();
    expect(document.querySelector("a")).toBeNull();
  });

  it("a pass reason on a passed record", () => {
    setup(rel({ status: "passed", passReason: "Not for this show" }));
    expect(screen.getByText(/Not for this show/)).toBeInTheDocument();
  });

  it("a demo co-sign shows its sample sender and no player box (co-signs get a player only through a Bandcamp link)", () => {
    setup(rel({ workspace: "demo", source: "cosign", artist: "[Artist]", senders: [{ name: "[Label or PR company]", messageId: "demo", at: 1 }] }), { demo: true });
    expect(screen.getByText("From [Label or PR company]")).toBeInTheDocument();
    expect(screen.queryByText("[Bandcamp player]")).toBeNull();
  });

  it("the Sample tag on a demo row", () => {
    setup(rel({ workspace: "demo", artist: "[Artist]" }), { demo: true });
    expect(screen.getAllByText("Sample").length).toBeGreaterThan(0);
  });
});

describe("other links", () => {
  it("domain in mono, then the full address as a new-tab link with noopener noreferrer nofollow, and the note", () => {
    setup(rel({ links: ["https://press.example.com/a/b?pk=1", "javascript:alert(1)", "ftp://x.example/a"] }));
    const link = screen.getByRole("link", { name: "https://press.example.com/a/b?pk=1" });
    expect(link).toHaveAttribute("href", "https://press.example.com/a/b?pk=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("press.example.com")).toHaveClass("font-mono");
    expect(screen.getByText("Air Check didn't open these. Check them yourself.")).toBeInTheDocument();
    expect(document.querySelectorAll("a")).toHaveLength(1);
  });

  it("the Bandcamp page shows the same way beside its player, and is not listed again", () => {
    const page = "https://nova.bandcamp.com/album/low-tide";
    setup(rel({ bandcampPage: page, links: [page], embed: { kind: "album", id: "42" }, embedState: "ready" }));
    const link = screen.getByRole("link", { name: page });
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("nova.bandcamp.com")).toHaveClass("font-mono");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("Air Check didn't open these. Check them yourself.")).toBeNull();
    expect(screen.getByRole("button", { name: "Play on Bandcamp" })).toBeInTheDocument();
  });
});

describe("actions", () => {
  const status = (a: RadarActions) => (a.setStatus as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

  it("new: Consider, Played and Pass with an optional reason; never more than one primary", async () => {
    const { actions } = setup(rel());
    expect(document.querySelectorAll(".bg-signal").length).toBeLessThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Consider" }));
    await waitFor(() => expect(status(actions)).toEqual([{ releaseId: "r1", status: "considering" }]));
    fireEvent.click(screen.getByRole("button", { name: "Played" }));
    await waitFor(() => expect(status(actions)[1]).toEqual({ releaseId: "r1", status: "played" }));
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Too slow" } });
    fireEvent.click(screen.getByRole("button", { name: "Pass on it" }));
    await waitFor(() => expect(status(actions)[2]).toEqual({ releaseId: "r1", status: "passed", reason: "Too slow" }));
  });

  it("the undo is Back to New (R10: short enough that the row fits a phone)", async () => {
    for (const s of ["considering", "played", "passed"] as const) {
      cleanup();
      const { actions } = setup(rel({ status: s }));
      expect(screen.queryByRole("button", { name: "Consider" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Back to New" }));
      await waitFor(() => expect(status(actions)).toEqual([{ releaseId: "r1", status: "new" }]));
    }
  });

  it("a refusal shows Convex's plain words", async () => {
    setup(rel(), { actions: acts({ setStatus: vi.fn(async () => { throw new ConvexError({ code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can do this" }); }) }) });
    fireEvent.click(screen.getByRole("button", { name: "Consider" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only a signed-in Radio Milwaukee user can do this");
  });

  it("Edit sends only the fields that changed", async () => {
    const { actions } = setup(rel());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Day Shift" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ep" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.edit).toHaveBeenCalledWith({ releaseId: "r1", fields: { label: "Day Shift", type: "ep" } }));
    await waitFor(() => expect(screen.queryByLabelText("Label")).toBeNull());
  });

  it("Edit: Set date and Date not known set the embargo", async () => {
    const { actions } = setup(rel());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Clear embargo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Date not known" }));
    await waitFor(() => expect(actions.setEmbargo).toHaveBeenCalledWith({ releaseId: "r1", embargo: { until: null } }));
    fireEvent.click(screen.getByRole("button", { name: "Set date" }));
    fireEvent.change(screen.getByLabelText("Embargoed until"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(actions.setEmbargo).toHaveBeenLastCalledWith({ releaseId: "r1", embargo: { until: "2026-11-20" } }));
  });

  it("Edit: Clear embargo asks once before it lets the release reach Mixcloud", async () => {
    const { actions } = setup(rel({ embargo: { until: null } }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear embargo" }));
    expect(actions.setEmbargo).not.toHaveBeenCalled();
    const ask = screen.getByText("This lets it reach Mixcloud.").parentElement!;
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("This lets it reach Mixcloud.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear embargo" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear it" }));
    await waitFor(() => expect(actions.setEmbargo).toHaveBeenCalledWith({ releaseId: "r1", embargo: null }));
  });

  it("phone: Consider, Played, Pass and Edit tighten their side padding below md so they share one row (height kept)", () => {
    setup(rel());
    for (const name of ["Consider", "Played", "Pass", "Edit"]) {
      const b = screen.getByRole("button", { name });
      expect(b.className).toMatch(/max-md:px-3/);
      expect(b.className).toMatch(/min-h-11/);
    }
    expect(screen.getByRole("button", { name: "Consider" }).parentElement!.className).toMatch(/max-md:gap-1\.5/);
  });

  it("all controls are 44px targets (min-h-11)", () => {
    setup(rel());
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/min-h-11/);
  });
});

// Plan 8 Task 6b: cover art, tags, the about and the favorite. All page text renders as text: no HTML, no links.
describe("art, tags, about and favorite (Task 6b)", () => {
  const ART = "https://f4.bcbits.com/img/a0000000001_5.jpg";
  const page = { art: ART, tags: ["deep house", "<b>jazz</b>"], about: "Recorded in one winter.\nOpen https://evil.example/a <script>x</script>" };

  it.each(["card", "row"] as const)("%s: a lazy cover image with plain alt text and no referrer", (layout) => {
    setup(rel(page), { layout });
    const img = screen.getByRole("img", { name: "Cover art for Low Tide by Nova Reyes" });
    expect(img).toHaveAttribute("src", ART);
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("art not on an https *.bcbits.com image is never drawn", () => {
    setup(rel({ art: "https://evil.example/img/a1_5.jpg" }));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("demo: a bracketed placeholder on a Bandcamp row, never the image; none on a co-sign", () => {
    setup(rel(page), { demo: true });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("[Cover art]")).toBeInTheDocument();
    cleanup();
    setup(rel({ ...page, source: "cosign" }), { demo: true });
    expect(screen.queryByText("[Cover art]")).toBeNull();
  });

  it.each(["card", "row"] as const)("%s: tags are plain-text chips; a click filters by that tag", (layout) => {
    const { ctx } = setup(rel(page), { layout });
    const tags = within(screen.getByRole("list", { name: "Tags" })).getAllByRole("button");
    expect(tags.map((b) => b.textContent)).toEqual(["deep house", "<b>jazz</b>"]);
    expect(document.querySelector("b")).toBeNull();
    for (const b of tags) expect(b).toHaveClass("min-h-11");
    fireEvent.click(tags[0]!);
    expect(ctx.onTag).toHaveBeenCalledWith("deep house");
  });

  it("the tag being filtered on is pressed", () => {
    setup(rel(page), { tag: "deep house" });
    expect(screen.getByRole("button", { name: "deep house" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "<b>jazz</b>" })).toHaveAttribute("aria-pressed", "false");
  });

  it("About is collapsed by default and shows the description as plain text, never a link", () => {
    setup(rel(page));
    const details = screen.getByText("About").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("About"));
    expect(within(details).getByText(/Recorded in one winter/)).toHaveTextContent("Open https://evil.example/a <script>x</script>");
    expect(details.querySelector("a, script")).toBeNull();
  });

  it("no about, no tags: neither is drawn", () => {
    setup(rel());
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.queryByRole("list", { name: "Tags" })).toBeNull();
  });

  it.each(["card", "row"] as const)("%s: the star toggles the favorite and nothing else", async (layout) => {
    const { actions } = setup(rel(), { layout });
    const star = screen.getByRole("button", { name: "Favorite “Low Tide” by Nova Reyes" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    expect(star).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(star);
    await waitFor(() => expect(actions.setFavorite).toHaveBeenCalledWith({ releaseId: "r1", favorite: true }));
    expect(actions.setStatus).not.toHaveBeenCalled();
    cleanup();
    const again = setup(rel({ favorite: true, status: "passed" }), { layout });
    const on = screen.getByRole("button", { name: "Favorite “Low Tide” by Nova Reyes" });
    expect(on).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(on);
    await waitFor(() => expect(again.actions.setFavorite).toHaveBeenCalledWith({ releaseId: "r1", favorite: false }));
  });

  it("R10: a Considering row's actions are Played, Pass, Back to New and Edit", () => {
    setup(rel({ status: "considering" }));
    const row = screen.getByRole("button", { name: "Played" }).parentElement!;
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Played", "Pass", "Back to New", "Edit"]);
  });

  it("the cover image's width and height match its box: 56 in a row, 64 on a card", () => {
    setup(rel(page), { layout: "row" });
    expect(screen.getByRole("img")).toHaveAttribute("width", "56");
    expect(screen.getByRole("img")).toHaveAttribute("height", "56");
    cleanup();
    setup(rel(page));
    expect(screen.getByRole("img")).toHaveAttribute("width", "64");
  });

  it("phone: the action row still holds only Consider, Played, Pass and Edit", () => {
    setup(rel(page));
    const actionRow = screen.getByRole("button", { name: "Consider" }).parentElement!;
    expect(within(actionRow).getAllByRole("button").map((b) => b.textContent)).toEqual(["Consider", "Played", "Pass", "Edit"]);
  });
});
