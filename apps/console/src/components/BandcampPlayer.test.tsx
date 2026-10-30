// @vitest-environment jsdom
import { bandcampEmbedSrc } from "@aircheck/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BandcampPlayer, embedErrorText } from "./BandcampPlayer";

afterEach(cleanup);

const base = { artist: "Nova Reyes", title: "Low Tide", demo: false, onRetry: vi.fn(async () => undefined) };

describe("BandcampPlayer", () => {
  it("renders no iframe until Play on Bandcamp is tapped, then Bandcamp's own player from kind and id only", () => {
    const embed = { kind: "album" as const, id: "123456" };
    const { container } = render(<BandcampPlayer {...base} embed={embed} embedState="ready" />);
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play on Bandcamp" }));
    const frame = container.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("src")).toBe(bandcampEmbedSrc(embed));
    expect(frame).toHaveAttribute("title", "Bandcamp player: Nova Reyes – Low Tide");
    expect(frame).toHaveAttribute("loading", "lazy");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    expect(frame).toHaveAttribute("width", "100%");
    expect(frame).toHaveAttribute("height", "120");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("a malformed stored id never crashes the page: the No player line instead", () => {
    const { container } = render(<BandcampPlayer {...base} embed={{ kind: "album", id: "12x<script>" }} embedState="ready" />);
    expect(screen.getByText(`No player: ${embedErrorText("bad_id")}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play on Bandcamp" })).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("queued: says it is getting the player, no button, no iframe", () => {
    const { container } = render(<BandcampPlayer {...base} embedState="queued" />);
    expect(screen.getByText("Getting the Bandcamp player…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("queued for over 10 minutes: the same hint the Not added rows use", () => {
    const now = Date.now();
    const { rerender } = render(<BandcampPlayer {...base} embedState="queued" embedQueuedAt={now - 11 * 60_000} />);
    expect(screen.getByText("Older than 10 minutes: the ingest worker may be down.")).toBeInTheDocument();
    rerender(<BandcampPlayer {...base} embedState="queued" embedQueuedAt={now - 60_000} />);
    expect(screen.queryByText(/Older than 10 minutes/)).toBeNull();
    rerender(<BandcampPlayer {...base} embedState="queued" />); // rows queued before the timestamp existed: no guess
    expect(screen.queryByText(/Older than 10 minutes/)).toBeNull();
  });

  it("failed: a plain reason and Try again calls retryEmbed", () => {
    const onRetry = vi.fn(async () => undefined);
    render(<BandcampPlayer {...base} onRetry={onRetry} embedState="failed" embedError="redirect_off_host" />);
    expect(screen.getByText(`No player: ${embedErrorText("redirect_off_host")}`)).toBeInTheDocument();
    expect(screen.queryByText(/redirect_off_host/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("every failure code reads as plain words, never the code", () => {
    for (const code of ["not_allowed", "redirect_off_host", "too_many_redirects", "not_html", "too_large", "no_player", "timeout", "network", "http_404", "something_new", undefined]) {
      const text = embedErrorText(code);
      expect(text).not.toMatch(/_/);
      expect(text.length).toBeGreaterThan(5);
    }
    expect(embedErrorText("http_404")).toContain("404");
  });

  it("demo: a bracketed placeholder with the Sample tag, never an iframe, even with an embed", () => {
    const { container } = render(<BandcampPlayer {...base} demo embed={{ kind: "album", id: "1" }} embedState="ready" />);
    expect(screen.getByText("[Bandcamp player]")).toBeInTheDocument();
    expect(screen.getByText("Sample")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("no Bandcamp page at all: nothing", () => {
    const { container } = render(<BandcampPlayer {...base} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Paste player (Oct 30: Bandcamp challenges the worker)", () => {
  const CODE = '<iframe src="https://bandcamp.com/EmbeddedPlayer/album=3847473100/size=large/"></iframe>';
  it("challenged: says Bandcamp asked for a human check, and the pasted code is saved", async () => {
    const onPaste = vi.fn(async () => undefined);
    render(<BandcampPlayer {...base} onPaste={onPaste} embedState="failed" embedError="challenged" />);
    expect(screen.getByText(/Bandcamp asked for a human check/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paste player" }));
    fireEvent.change(screen.getByLabelText("Bandcamp embed code"), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Save player" }));
    await waitFor(() => expect(onPaste).toHaveBeenCalledWith(CODE));
  });
  it("no Bandcamp link in the email: a plain line and the paste box, nothing else", () => {
    render(<BandcampPlayer {...base} onPaste={vi.fn(async () => undefined)} />);
    expect(screen.getByText("No Bandcamp link in the email.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Paste player" })).toBeTruthy();
  });
  it("a refused paste shows the reason; Cancel closes the box", async () => {
    const onPaste = vi.fn(async () => { throw new Error("That isn't Bandcamp's embed code."); });
    render(<BandcampPlayer {...base} onPaste={onPaste} embedState="failed" embedError="no_player" />);
    fireEvent.click(screen.getByRole("button", { name: "Paste player" }));
    fireEvent.change(screen.getByLabelText("Bandcamp embed code"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save player" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Bandcamp embed code")).toBeNull();
  });
  it("the demo never shows the paste box", () => {
    render(<BandcampPlayer {...base} demo onPaste={vi.fn(async () => undefined)} />);
    expect(screen.queryByRole("button", { name: "Paste player" })).toBeNull();
  });
});
