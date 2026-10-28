// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionUpdate, type UpdateFns, type UpdateView } from "./DescriptionUpdate";

afterEach(cleanup);

// Plan 5c Task 4: on a show already on Mixcloud, propose a new description, compare it with the live one, and approve
// the exact text (its fingerprint). The publisher sends it; the page follows the update's status.
const LIVE = "Warm soul from Milwaukee, start to finish.";
const SOURCES = [{ claim: "Played bass with Ezra Collective", source: "crate: musicbrainz artist lookup" }];
const view = (latest: Partial<NonNullable<UpdateView["latest"]>> | null = null, live: Partial<UpdateView["live"]> = {}): UpdateView => ({
  live: { description: LIVE, ...live },
  latest: latest && { id: "u1", status: "proposed", description: "A brighter take on the same two hours.", proposedBy: "agent", fingerprint: "fpA", ...latest },
});
function fns(over: Partial<UpdateFns> = {}) {
  const propose = vi.fn<UpdateFns["propose"]>(async () => ({ ok: true, replaced: false }));
  const approve = vi.fn<UpdateFns["approve"]>(async () => ({ ok: true }));
  return { propose, approve, ...over };
}
const setup = (v: UpdateView, f = fns()) => ({ f, ...render(<DescriptionUpdate view={v} trackTitles={["Song One", "Song Two"]} fns={f} />) });

describe("DescriptionUpdate", () => {
  it("shows what Mixcloud shows now, with its count, and a way to propose a new one", () => {
    setup(view());
    expect(screen.getByRole("heading", { name: "Description on Mixcloud" })).toBeInTheDocument();
    expect(screen.getByText(LIVE)).toBeInTheDocument();
    expect(screen.getByText(`${[...LIVE].length} characters`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update the description on Mixcloud" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve update" })).toBeNull();
  });

  it("the proposal box checks as you type, counts code points, and proposes the text", async () => {
    const { f } = setup(view());
    fireEvent.click(screen.getByRole("button", { name: "Update the description on Mixcloud" }));
    const box = screen.getByLabelText("New description");
    expect(box).toHaveValue(LIVE);
    const propose = screen.getByRole("button", { name: "Propose update" });
    expect(propose).toBeDisabled(); // same as the live text
    fireEvent.change(box, { target: { value: "Out today: a café 🎷 set." } });
    expect(screen.getAllByText(/time-relative phrase/).length).toBeGreaterThan(0);
    expect(screen.getByText("24 / 999")).toBeInTheDocument();
    expect(propose).toBeDisabled();
    fireEvent.change(box, { target: { value: "A café 🎷 set." } });
    expect(propose).toBeEnabled();
    await act(async () => fireEvent.click(propose));
    expect(f.propose).toHaveBeenCalledWith("A café 🎷 set.");
    expect(screen.queryByLabelText("New description")).toBeNull();
  });

  it("a refused proposal says why and keeps the text", async () => {
    setup(view(), fns({ propose: async () => ({ ok: false, message: "description contains a private term" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Update the description on Mixcloud" }));
    fireEvent.change(screen.getByLabelText("New description"), { target: { value: "New words here." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Propose update" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Description contains a private term");
    expect(screen.getByLabelText("New description")).toHaveValue("New words here.");
  });

  it("a proposal sits beside the live text with its sources; Approve update sends its fingerprint", async () => {
    const { f } = setup(view({ descriptionSources: SOURCES }));
    expect(screen.getByText("Live on Mixcloud")).toBeInTheDocument();
    expect(screen.getByText("Proposed by the agent")).toBeInTheDocument();
    expect(screen.getByText(LIVE)).toBeInTheDocument();
    expect(screen.getByText("A brighter take on the same two hours.")).toBeInTheDocument();
    expect(screen.getByText("Played bass with Ezra Collective")).toBeInTheDocument();
    expect(screen.getByText(/Only the description changes/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve update" })));
    expect(f.approve).toHaveBeenCalledWith("u1", "fpA");
  });

  it("a refused approve says why", async () => {
    setup(view({ proposedBy: "human" }), fns({ approve: async () => ({ ok: false, message: "This proposal changed. Review the latest version." }) }));
    expect(screen.getByText("Proposed by you")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve update" })));
    expect(screen.getByRole("alert")).toHaveTextContent("This proposal changed");
  });

  it("a proposal replaced while you read it is pinned: Approve waits for Reload, then sends the new fingerprint", async () => {
    const f = fns();
    const r = setup(view({}), f);
    r.rerender(<DescriptionUpdate view={view({ id: "u2", description: "Replaced words.", fingerprint: "fpB" })} trackTitles={[]} fns={f} />);
    expect(screen.getByText("A brighter take on the same two hours.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This proposal changed. Open the latest version.");
    expect(screen.getByRole("button", { name: "Approve update" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByText("Replaced words.")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve update" })));
    expect(f.approve).toHaveBeenCalledWith("u2", "fpB");
  });

  it.each(["approved", "pushing"] as const)("%s: Updating on Mixcloud…, nothing to approve or propose", (status) => {
    setup(view({ status }));
    expect(screen.getByText("Updating on Mixcloud…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve update|Update the description/ })).toBeNull();
  });

  it("pushed: says when, and a new update can be proposed", () => {
    setup(view({ status: "pushed", pushedAt: "2026-10-28T15:04:00.000Z" }, { updatedAt: "2026-10-28T15:04:00.000Z" }));
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update the description on Mixcloud" })).toBeInTheDocument();
  });

  it("failed: the reason in plain words, and Propose again opens the box with that text", () => {
    setup(view({ status: "failed", error: "retries_exhausted" }));
    expect(screen.getByText(/didn't answer after 3 tries/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Propose again" }));
    expect(screen.getByLabelText("New description")).toHaveValue("A brighter take on the same two hours.");
  });

  it("failed unconfirmed: says Mixcloud accepted it but didn't confirm, so it may already be live", () => {
    setup(view({ status: "failed", error: "unconfirmed" }));
    expect(screen.getByText("Mixcloud accepted the request but didn't confirm it. Check the show page — the new description may already be live.")).toBeInTheDocument();
    expect(screen.queryByText(/didn't answer after 3 tries/)).toBeNull();
  });

  it("an unknown failure code is shown as written", () => {
    setup(view({ status: "failed", error: "http_404" }));
    expect(screen.getByText(/http_404/)).toBeInTheDocument();
  });
});
