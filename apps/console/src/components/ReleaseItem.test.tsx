// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embargoLabel, ReleaseItem, type RadarActions, type Release, type ReleaseCtx } from "./ReleaseItem";

// Listening-queue brief D: one compact block per release, the same order on a phone and a desk.
//   [art] Title ☆ / Artist · Label / (From sender) / type · Out · received · tags (embargo pill) / [Play] [Consider] [Pass] More
afterEach(cleanup);

const TODAY = "2026-10-30";
const AT = Date.UTC(2026, 9, 30, 3); // 03:00 UTC on Oct 30 is still Oct 29 in Milwaukee
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
  receivedAt: AT,
  ...over,
});
const PAGE = "https://nova.bandcamp.com/album/low-tide";
const READY = { bandcampPage: PAGE, links: [PAGE], embed: { kind: "album" as const, id: "42" }, embedState: "ready" as const };
const noop = async () => undefined;
const acts = (over: Partial<RadarActions> = {}): RadarActions => ({
  setStatus: vi.fn(noop), edit: vi.fn(noop), setEmbargo: vi.fn(noop), retry: vi.fn(noop), retryEmbed: vi.fn(noop), setFavorite: vi.fn(noop), ...over,
});
function setup(r: Release, { actions = acts(), demo = false, tag = undefined as string | undefined, playing = undefined as string | undefined, showStatus = false } = {}) {
  const ctx: ReleaseCtx = { actions, announce: vi.fn(), today: TODAY, demo, tab: r.source ?? "bandcamp", tag, onTag: vi.fn(), playing, onPlay: vi.fn(), showStatus };
  render(<ol><ReleaseItem r={r} ctx={ctx} /></ol>);
  return { actions, ctx };
}
const more = () => fireEvent.click(screen.getByRole("button", { name: "More" }));
const actionRow = () => screen.getByRole("group", { name: "Actions" });

describe("a block shows", () => {
  it("title, Artist · Label, then type, genre, release date and the received date (short: this year)", () => {
    setup(rel());
    expect(screen.getByText("Low Tide")).toBeInTheDocument();
    expect(screen.getByText("Nova Reyes · Night Shift")).toBeInTheDocument();
    expect(screen.getByText("Album · Jazz · Out Nov 14 · received Oct 29")).toBeInTheDocument();
    expect(screen.queryByText(/From Bandcamp/)).toBeNull(); // Bandcamp's own name is noise on its own tab
  });

  it("another year keeps its year; no label, no date, no receivedAt: those parts are left out", () => {
    setup(rel({ releasedOn: "2027-01-08" }));
    expect(screen.getByText(/Out Jan 8, 2027/)).toBeInTheDocument();
    cleanup();
    setup(rel({ label: undefined, genre: undefined, type: undefined, releasedOn: undefined, receivedAt: undefined }));
    expect(screen.getByText("Nova Reyes")).toBeInTheDocument();
    expect(screen.queryByText(/received|Out /)).toBeNull();
  });

  it("co-signs: the sender line sits right under Artist · Label", () => {
    setup(rel({ source: "cosign", senders: [{ name: "Coastline PR", messageId: "m", at: 1 }] }));
    const artist = screen.getByText("Nova Reyes · Night Shift");
    expect(artist.nextElementSibling).toHaveTextContent("From Coastline PR");
  });

  it("the embargo pill sits in the dates line: dated, undated, and none once the date has come", () => {
    expect(embargoLabel({ until: "2026-11-07" }, TODAY)).toBe("Embargoed until Nov 7");
    expect(embargoLabel({ until: "2027-01-07" }, TODAY)).toBe("Embargoed until Jan 7, 2027");
    expect(embargoLabel({ until: null }, TODAY)).toBe("Embargoed · date not known");
    expect(embargoLabel({ until: "2026-10-30" }, TODAY)).toBeNull();
    expect(embargoLabel(undefined, TODAY)).toBeNull();
    setup(rel({ embargo: { until: "2026-11-07" } }));
    const pill = screen.getByText("Embargoed until Nov 7");
    expect(pill).toHaveClass("bg-caution-bg");
    expect(pill.closest("[data-meta]")).toHaveTextContent("received Oct 29");
  });

  it("R5: a later email's embargo after Tarik cleared it is a quiet note, not a pill", () => {
    setup(rel({ laterEmbargoNotice: { at: 5, until: "2026-12-01" } }));
    expect(screen.getByText("A newer email mentions an embargo — you cleared it")).toBeInTheDocument();
    expect(screen.queryByText(/^Embargoed/)).toBeNull();
  });

  it("the sender is plain text, never a link, even when it looks like one", () => {
    setup(rel({ source: "cosign", senders: [{ name: "<a href=\"https://evil.example\">x</a> https://evil.example", messageId: "m", at: 1 }] }));
    expect(screen.getByText(/From .*https:\/\/evil\.example/)).toBeInTheDocument();
    expect(document.querySelector("a")).toBeNull();
  });

  it("a pass reason on a passed record", () => {
    setup(rel({ status: "passed", passReason: "Not for this show" }));
    expect(screen.getByText("Passed: Not for this show")).toBeInTheDocument();
  });

  it("the status pill shows only when the list mixes statuses (All)", () => {
    setup(rel({ status: "considering" }));
    expect(screen.queryByText("Considering")).toBeNull();
    cleanup();
    setup(rel({ status: "considering" }), { showStatus: true });
    expect(screen.getByText("Considering")).toBeInTheDocument();
  });

  it("demo: the Sample tag; a demo co-sign shows its sample sender and has no Play (no page)", () => {
    setup(rel({ workspace: "demo", artist: "[Artist]" }), { demo: true });
    expect(screen.getAllByText("Sample").length).toBeGreaterThan(0);
    cleanup();
    setup(rel({ workspace: "demo", source: "cosign", artist: "[Artist]", senders: [{ name: "[Label or PR company]", messageId: "demo", at: 1 }] }), { demo: true });
    expect(screen.getByText("From [Label or PR company]")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.queryByText("[Bandcamp player]")).toBeNull();
  });
});

describe("Play", () => {
  it("a ready player: Play asks the list to open this one; open, it is Bandcamp's sandboxed player and Stop closes it", () => {
    const { ctx } = setup(rel(READY));
    const play = within(actionRow()).getByRole("button", { name: "Play" });
    expect(play).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(play);
    expect(ctx.onPlay).toHaveBeenCalledWith("r1");
    expect(document.querySelector("iframe")).toBeNull();
    cleanup();
    const open = setup(rel(READY), { playing: "r1" });
    const iframe = document.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toMatch(/^https:\/\/bandcamp\.com\/EmbeddedPlayer\/album=42\//);
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(stop);
    expect(open.ctx.onPlay).toHaveBeenCalledWith(undefined);
  });

  it("no player: no Play, the reason line as before (queued, failed with Try again)", async () => {
    setup(rel({ ...READY, embed: undefined, embedState: "queued" }));
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.getByText("Getting the Bandcamp player…")).toBeInTheDocument();
    cleanup();
    const { actions } = setup(rel({ ...READY, embed: undefined, embedState: "failed", embedError: "timeout" }));
    expect(screen.getByText("No player: Bandcamp took longer than 15 seconds")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(actions.retryEmbed).toHaveBeenCalledWith({ releaseId: "r1" }));
  });

  it("a co-sign with no Bandcamp page has no Play; one with a ready page does", () => {
    setup(rel({ source: "cosign" }));
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    cleanup();
    setup(rel({ source: "cosign", ...READY }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("demo Bandcamp row: Play opens the bracketed placeholder, never a real player", () => {
    setup(rel({ workspace: "demo" }), { demo: true, playing: "r1" });
    expect(screen.getByText("[Bandcamp player]")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("links (brief C)", () => {
  it("Bandcamp tab: no email links anywhere; the page link sits in More", () => {
    setup(rel({ ...READY, links: [PAGE, "https://bandcamp.com/fan_unsubscribe?x=1", "https://press.example.com/a"] }));
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    more();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([PAGE]);
    expect(screen.getByRole("link", { name: PAGE })).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.queryByText("Air Check didn't open these. Check them yourself.")).toBeNull();
  });

  it("co-signs: the cleaned links in More, domain in mono, new tab, noopener noreferrer nofollow, and the note", () => {
    setup(rel({ source: "cosign", links: ["https://press.example.com/a/b?pk=1", "javascript:alert(1)", "ftp://x.example/a"] }));
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    more();
    const link = screen.getByRole("link", { name: "https://press.example.com/a/b?pk=1" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("press.example.com")).toHaveClass("font-mono");
    expect(screen.getByText("Air Check didn't open these. Check them yourself.")).toBeInTheDocument();
    expect(document.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("actions", () => {
  const status = (a: RadarActions) => (a.setStatus as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
  const names = () => within(actionRow()).getAllByRole("button").map((b) => b.textContent);

  it("new: Play, Consider and Pass on one row, then More; no green button", () => {
    setup(rel(READY));
    expect(names()).toEqual(["Play", "Consider", "Pass", "More"]);
    expect(document.querySelectorAll(".bg-signal")).toHaveLength(0);
  });

  it("Consider moves it; Pass takes an optional reason", async () => {
    const { actions } = setup(rel());
    fireEvent.click(screen.getByRole("button", { name: "Consider" }));
    await waitFor(() => expect(status(actions)).toEqual([{ releaseId: "r1", status: "considering" }]));
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Too slow" } });
    fireEvent.click(screen.getByRole("button", { name: "Pass on it" }));
    await waitFor(() => expect(status(actions)[1]).toEqual({ releaseId: "r1", status: "passed", reason: "Too slow" }));
  });

  it("considering: Pass and Back to New; played and passed: Back to New", async () => {
    setup(rel({ status: "considering" }));
    expect(names()).toEqual(["Pass", "Back to New", "More"]);
    for (const s of ["played", "passed"] as const) {
      cleanup();
      const { actions } = setup(rel({ status: s }));
      expect(names()).toEqual(["Back to New", "More"]);
      fireEvent.click(screen.getByRole("button", { name: "Back to New" }));
      await waitFor(() => expect(status(actions)).toEqual([{ releaseId: "r1", status: "new" }]));
    }
  });

  it("More reveals Played, Edit, the embargo controls, About and every tag; it says whether it is open", async () => {
    const { actions } = setup(rel({ about: "Recorded in one winter.", tags: ["a", "b", "c", "d", "e"] }));
    const toggle = screen.getByRole("button", { name: "More" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Played" })).toBeNull();
    expect(screen.queryByRole("button", { name: "e" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Played", "Edit", "Set date", "Date not known", "e"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Played" }));
    await waitFor(() => expect(status(actions)).toEqual([{ releaseId: "r1", status: "played" }]));
  });

  it("a refusal shows Convex's plain words", async () => {
    setup(rel(), { actions: acts({ setStatus: vi.fn(async () => { throw new ConvexError({ code: "FORBIDDEN", message: "only a signed-in Radio Milwaukee user can do this" }); }) }) });
    fireEvent.click(screen.getByRole("button", { name: "Consider" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only a signed-in Radio Milwaukee user can do this");
  });

  it("Edit (in More) sends only the fields that changed", async () => {
    const { actions } = setup(rel());
    more();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Day Shift" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ep" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.edit).toHaveBeenCalledWith({ releaseId: "r1", fields: { label: "Day Shift", type: "ep" } }));
    await waitFor(() => expect(screen.queryByLabelText("Label")).toBeNull());
  });

  it("embargo (in More): Set date and Date not known set it", async () => {
    const { actions } = setup(rel());
    more();
    expect(screen.queryByRole("button", { name: "Clear embargo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Date not known" }));
    await waitFor(() => expect(actions.setEmbargo).toHaveBeenCalledWith({ releaseId: "r1", embargo: { until: null } }));
    fireEvent.click(screen.getByRole("button", { name: "Set date" }));
    fireEvent.change(screen.getByLabelText("Embargoed until"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(actions.setEmbargo).toHaveBeenLastCalledWith({ releaseId: "r1", embargo: { until: "2026-11-20" } }));
  });

  it("Clear embargo (in More) asks once before it lets the release reach Mixcloud", async () => {
    const { actions } = setup(rel({ embargo: { until: null } }));
    more();
    fireEvent.click(screen.getByRole("button", { name: "Clear embargo" }));
    expect(actions.setEmbargo).not.toHaveBeenCalled();
    const ask = screen.getByText("This lets it reach Mixcloud.").parentElement!;
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("This lets it reach Mixcloud.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear embargo" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear it" }));
    await waitFor(() => expect(actions.setEmbargo).toHaveBeenCalledWith({ releaseId: "r1", embargo: null }));
  });

  it("phone: the action row never wraps Play, Consider and Pass apart, and every button is a 44px target", () => {
    setup(rel({ ...READY, tags: ["deep house"], about: "x" }));
    expect(actionRow().className).toMatch(/flex-nowrap/);
    for (const name of ["Play", "Consider", "Pass", "More"]) expect(screen.getByRole("button", { name }).className).toMatch(/max-md:px-3/);
    more();
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/min-h-11/);
  });
});

// Plan 8 Task 6b: cover art, tags, the about and the favorite. All page text renders as text: no HTML, no links.
describe("art, tags, about and favorite", () => {
  const ART = "https://f4.bcbits.com/img/a0000000001_5.jpg";
  const page = { art: ART, tags: ["deep house", "<b>jazz</b>"], about: "Recorded in one winter.\nOpen https://evil.example/a <script>x</script>" };

  it("a lazy cover image with plain alt text, no referrer, 64px", () => {
    setup(rel(page));
    const img = screen.getByRole("img", { name: "Cover art for Low Tide by Nova Reyes" });
    expect(img).toHaveAttribute("src", ART);
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(img).toHaveAttribute("width", "64");
    expect(img).toHaveAttribute("height", "64");
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

  it("the first three tags sit in the dates line as plain-text chips; a click filters by that tag", () => {
    const { ctx } = setup(rel(page));
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

  it("About (in More) is collapsed and shows the description as plain text, never a link", () => {
    setup(rel(page));
    more();
    const details = screen.getByText("About").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("About"));
    expect(within(details).getByText(/Recorded in one winter/)).toHaveTextContent("Open https://evil.example/a <script>x</script>");
    expect(details.querySelector("a, script")).toBeNull();
  });

  it("no about, no tags: neither is drawn", () => {
    setup(rel());
    more();
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.queryByRole("list", { name: "Tags" })).toBeNull();
  });

  it("the star toggles the favorite and nothing else", async () => {
    const { actions } = setup(rel());
    const star = screen.getByRole("button", { name: "Favorite “Low Tide” by Nova Reyes" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    expect(star).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(star);
    await waitFor(() => expect(actions.setFavorite).toHaveBeenCalledWith({ releaseId: "r1", favorite: true }));
    expect(actions.setStatus).not.toHaveBeenCalled();
    cleanup();
    const again = setup(rel({ favorite: true, status: "passed" }));
    const on = screen.getByRole("button", { name: "Favorite “Low Tide” by Nova Reyes" });
    expect(on).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(on);
    await waitFor(() => expect(again.actions.setFavorite).toHaveBeenCalledWith({ releaseId: "r1", favorite: false }));
  });
});
