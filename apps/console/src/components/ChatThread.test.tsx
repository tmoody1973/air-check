// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConvexError } from "convex/values";
import type { PackageRecord } from "@aircheck/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatThread, type ChatMessage, type RunView } from "./ChatThread";

afterEach(cleanup);
vi.spyOn(console, "error").mockImplementation(() => {});

const user = (text: string, id = "u1"): ChatMessage => ({ _id: id, role: "user", text, at: 1 });
const bot = (text: string, runId = "r1", id = "a1"): ChatMessage => ({ _id: id, role: "assistant", text, runId, at: 1 });
const run = (over: Partial<RunView> = {}): RunView => ({ status: "running", source: "live", state: { steps: [] }, ...over });
const record = (): PackageRecord => ({
  status: "awaiting_review",
  draft: {
    id: "pkg1", workspace: "demo", showDate: "2026-10-02", title: "Pkg title", tags: ["Jazz"], description: "d",
    tracks: [{ hour: 1, position: 1, artist: "A", title: "B", raw: "", closing: true }], audio: { hour1Id: "a", hour2Id: "b" },
  },
});

function setup(o: { missing?: boolean; messages?: ChatMessage[] | undefined; runs?: Record<string, RunView | null | undefined>; pkgs?: Record<string, PackageRecord | null>; send?: (t: string) => Promise<unknown> } = {}) {
  const send = vi.fn(o.send ?? (async () => ({})));
  const props = {
    messages: "messages" in o ? o.messages : [],
    send,
    useRun: (id: string) => o.runs?.[id],
    missing: o.missing,
    usePackage: (id: string | undefined) => (id ? (o.pkgs?.[id] ?? null) : null),
  };
  const view = render(<ChatThread {...props} />);
  return { send, rerender: (m: Partial<typeof props>) => view.rerender(<ChatThread {...props} {...m} />) };
}
const box = () => screen.getByLabelText("Message Air Check") as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(box(), { target: { value: v } });
const enter = (shiftKey = false) => fireEvent.keyDown(box(), { key: "Enter", shiftKey });

describe("ChatThread sending", () => {
  it("clears the box and shows the user message at once, before the server answers", async () => {
    let resolve!: () => void;
    const { send } = setup({ send: () => new Promise<void>((r) => (resolve = r)) });
    type("Draft the 10-2-26 package");
    enter();
    expect(box().value).toBe("");
    expect(screen.getByText("Draft the 10-2-26 package")).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith("Draft the 10-2-26 package");
    await act(async () => resolve());
  });
  it("sends once on a double Enter", async () => {
    const { send } = setup({ send: () => new Promise(() => {}) });
    type("hello");
    enter();
    type("hello");
    enter();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("Shift+Enter does not send", () => {
    const { send } = setup();
    type("a\nb");
    enter(true);
    expect(send).not.toHaveBeenCalled();
  });
  it("ignores an empty message", () => {
    const { send } = setup();
    type("   ");
    enter();
    expect(send).not.toHaveBeenCalled();
  });
  it("send button disabled while a send is in flight", async () => {
    setup({ send: () => new Promise(() => {}) });
    type("hi");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
  it("on failure: plain message, pending message removed, text restored", async () => {
    setup({ send: async () => { throw new ConvexError({ code: "RATE_LIMITED" }); } });
    type("hello there");
    enter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Demo limit reached: answers are sample replies until tomorrow.");
    expect(box().value).toBe("hello there");
    expect(screen.queryByText("hello there", { selector: "p" })).not.toBeInTheDocument();
    enter();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
  it("a prototype-key code gets the generic message", async () => {
    setup({ send: async () => { throw new ConvexError({ code: "constructor" }); } });
    type("x");
    enter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send. Please try again.");
  });
  it("refuses over 8,000 characters without calling the server", () => {
    const { send } = setup();
    type("x".repeat(8001));
    enter();
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Messages can be up to 8,000 characters.");
  });
});

describe("ChatThread replies", () => {
  it("shows the empty state with no messages", () => {
    setup();
    expect(screen.getByText(/ask air check/i, { selector: "p" })).toBeInTheDocument();
  });
  it("a growing reply re-renders", () => {
    const runs = { r1: run() };
    const { rerender } = setup({ messages: [user("hi"), bot("Found")], runs });
    expect(screen.getByText("Found")).toBeInTheDocument();
    rerender({ messages: [user("hi"), bot("Found both hours")] });
    expect(screen.getByText("Found both hours")).toBeInTheDocument();
  });
  it("empty reply while the run is going shows an accessible ellipsis, never an empty bubble", () => {
    setup({ messages: [user("hi"), bot("")], runs: { r1: run({ status: "running" }) } });
    expect(screen.getByRole("status", { name: "The agent is writing" })).toHaveTextContent("…");
  });
  it("empty reply, run failed", () => {
    setup({ messages: [user("hi"), bot("")], runs: { r1: run({ status: "failed" }) } });
    expect(screen.getByText("The agent stopped with an error.")).toBeInTheDocument();
  });
  it("empty reply, run cancelled", () => {
    setup({ messages: [user("hi"), bot("")], runs: { r1: run({ status: "cancelled" }) } });
    expect(screen.getByText("Stopped.")).toBeInTheDocument();
  });
  it("empty reply, run completed without text", () => {
    setup({ messages: [user("hi"), bot("")], runs: { r1: run({ status: "completed" }) } });
    expect(screen.getByText("The agent finished without a reply.")).toBeInTheDocument();
  });
  it("progress line while queued and running, linking to the run", () => {
    const { rerender } = setup({ messages: [user("hi"), bot("")], runs: { r1: run({ status: "queued" }) } });
    expect(screen.getByRole("link", { name: "Waiting for the agent…" })).toHaveAttribute("href", "/runs/r1");
    rerender({ useRun: () => run({ status: "running", state: { steps: [{ tool: "a" }, { tool: "mcp__crate__musicbrainz_search_artist" }] } }) });
    expect(screen.getByRole("link", { name: "Searching MusicBrainz · step 2" })).toHaveAttribute("href", "/runs/r1");
  });
  it("no progress line once the run is done", () => {
    setup({ messages: [user("hi"), bot("Done")], runs: { r1: run({ status: "completed" }) } });
    expect(screen.queryByRole("link", { name: /step|Waiting/ })).not.toBeInTheDocument();
  });
  it("labels the source like the run card", () => {
    const { rerender } = setup({ messages: [user("hi"), bot("A")], runs: { r1: run({ source: "live", status: "completed" }) } });
    expect(screen.getByText("Live · Nemotron")).toBeInTheDocument();
    rerender({ useRun: () => run({ source: "scripted", status: "completed" }) });
    expect(screen.getByText("Sample · scripted")).toBeInTheDocument();
  });
  it("renders the package card from the record, with no approve button", () => {
    setup({
      messages: [user("hi"), bot("Here it is")],
      runs: { r1: run({ status: "completed", packageId: "pkg1" }) },
      pkgs: { pkg1: record() },
    });
    expect(screen.getByRole("heading", { name: "Pkg title" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review full package" })).toHaveAttribute("href", "/packages/pkg1");
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });
  it("no card when the run has a package id but the record is not there", () => {
    setup({ messages: [user("hi"), bot("x")], runs: { r1: run({ status: "completed", packageId: "pkg1" }) }, pkgs: {} });
    expect(screen.queryByRole("link", { name: "Review full package" })).not.toBeInTheDocument();
  });
  it("agent text renders as literal text, never as HTML", () => {
    const evil = `<script>window.__pwn=1</script><b>bold</b>`;
    setup({ messages: [user("hi"), bot(evil)], runs: { r1: run({ status: "completed" }) } });
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });
  it("keeps line breaks", () => {
    setup({ messages: [user("hi"), bot("one\ntwo")], runs: { r1: run({ status: "completed" }) } });
    expect(screen.getByText(/one/)).toHaveClass("whitespace-pre-wrap");
  });
});

describe("ChatThread follow, not-found and input fixes", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 0 });
  });
  const scrollTo = (fromBottom: number) => {
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 5000 - window.innerHeight - fromBottom });
    fireEvent.scroll(window);
  };

  it("does not scroll on mount with no messages", () => {
    setup();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it("scrolls when the reply text grows and the reader is at the bottom", () => {
    const runs = { r1: run() };
    const { rerender } = setup({ messages: [user("hi"), bot("Fo")], runs });
    scrollIntoView.mockClear();
    rerender({ messages: [user("hi"), bot("Found both hours")] });
    expect(scrollIntoView).toHaveBeenCalled();
  });
  it("does not scroll when the reader has scrolled up", () => {
    const runs = { r1: run() };
    const { rerender } = setup({ messages: [user("hi"), bot("Fo")], runs });
    scrollTo(800);
    scrollIntoView.mockClear();
    rerender({ messages: [user("hi"), bot("Found both hours")] });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it("scrolls when the run status changes", () => {
    const { rerender } = setup({ messages: [user("hi"), bot("")], runs: { r1: run({ status: "queued" }) } });
    scrollIntoView.mockClear();
    rerender({ useRun: () => run({ status: "running" }) });
    expect(scrollIntoView).toHaveBeenCalled();
  });
  it("shows a note and no composer for a conversation that is not ours", () => {
    setup({ messages: [], missing: true });
    expect(screen.getByText("That conversation isn't here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new conversation" })).toHaveAttribute("href", "/chat");
    expect(screen.queryByLabelText("Message Air Check")).not.toBeInTheDocument();
    expect(screen.queryByText(/ask air check to draft/i)).not.toBeInTheDocument();
  });
  it("a missing run (null) says Run unavailable, loading (undefined) keeps the ellipsis", () => {
    setup({ messages: [user("hi"), bot("")], runs: { r1: null } });
    expect(screen.getByText("Run unavailable.")).toBeInTheDocument();
    cleanup();
    setup({ messages: [user("hi"), bot("")], runs: { r1: undefined } });
    expect(screen.getByRole("status", { name: "The agent is writing" })).toBeInTheDocument();
  });
  it("keeps the sent message until the saved copy arrives, then shows it once", async () => {
    const { rerender } = setup({ messages: undefined, send: async () => ({}) });
    type("first one");
    enter();
    await waitFor(() => expect(box().value).toBe(""));
    expect(screen.getByText("first one")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    rerender({ messages: [user("first one"), bot("", "r1", "a1")] });
    await waitFor(() => expect(screen.getAllByText("first one")).toHaveLength(1));
  });
  it("a failed send does not overwrite text typed meanwhile", async () => {
    let fail!: () => void;
    setup({ send: () => new Promise((_, rej) => (fail = () => rej(new ConvexError({ code: "NOT_FOUND" })))) });
    type("sent text");
    enter();
    type("typed meanwhile");
    await act(async () => fail());
    expect(box().value).toBe("typed meanwhile");
  });
  it("does not send on Enter during IME composition (keyCode 229)", () => {
    const { send } = setup();
    type("にほん");
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
  });
});
