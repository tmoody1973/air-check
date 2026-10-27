// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerBar } from "./PlayerBar";
import { PlayerProvider, type PlayerTrack } from "./PlayerProvider";

const withHour2: PlayerTrack = { src: "/demo/sample-hour.mp3", title: "RLR 10.2.26", durationSec: 20, hour2AtSec: 10 };
const noHour2: PlayerTrack = { src: "/x.mp3", title: "Other", durationSec: 20 };
let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("play")); return Promise.resolve(); });
  pause = vi.fn(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
  HTMLMediaElement.prototype.play = play as never;
  HTMLMediaElement.prototype.pause = pause as never;
});
afterEach(cleanup);

const setup = (track: PlayerTrack | null) =>
  render(<PlayerProvider><input aria-label="typing" /><PlayerBar track={track} /></PlayerProvider>);

describe("PlayerBar", () => {
  it("jump to hour 2 seeks to hour2AtSec", () => {
    const { container } = setup(withHour2);
    fireEvent.click(screen.getByRole("button", { name: "Jump to hour 2" }));
    expect(container.ownerDocument.querySelector("audio")!.currentTime).toBe(10);
    expect(screen.getByText("0:00:10 / 0:00:20")).toBeInTheDocument();
  });

  it("jump is disabled without hour2AtSec", () => {
    setup(noHour2);
    expect(screen.getByRole("button", { name: "Jump to hour 2" })).toBeDisabled();
  });

  it("space toggles play but not inside an input", () => {
    setup(withHour2);
    fireEvent.keyDown(document.body, { key: " " });
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("typing"), { key: " " });
    expect(pause).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("shows the placeholder when there is no track", () => {
    setup(null);
    expect(screen.getByText("Audio preview arrives with the media job")).toBeInTheDocument();
  });
});

describe("PlayerProvider", () => {
  it("Space does nothing (and is not prevented) when no PlayerBar is mounted", () => {
    render(<PlayerProvider><p>no bar</p></PlayerProvider>);
    const ev = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(play).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("same src with a different title updates the title and keeps position", () => {
    const a: PlayerTrack = { src: "/same.mp3", title: "Golden", durationSec: 20 };
    const { container, rerender } = render(<PlayerProvider><PlayerBar track={a} /></PlayerProvider>);
    const audio = container.ownerDocument.querySelector("audio")!;
    audio.currentTime = 5;
    fireEvent.timeUpdate(audio);
    expect(screen.getByText("Golden")).toBeInTheDocument();
    rerender(<PlayerProvider><PlayerBar track={{ ...a, title: "Long title" }} /></PlayerProvider>);
    expect(screen.getByText("Long title")).toBeInTheDocument();
    expect(screen.getByText("0:00:05 / 0:00:20")).toBeInTheDocument();
  });
});
