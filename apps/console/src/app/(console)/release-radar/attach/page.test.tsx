// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const paste = vi.fn(async () => undefined);
const found = [{ _id: "r1", artist: "Versa", title: "Reset", hasPlayer: false }];
vi.mock("convex/react", () => ({
  useQuery: (name: string) => (name === "radar.attachCandidates" ? found : undefined),
  useMutation: () => paste,
}));
vi.mock("../../../../../convex/_generated/api", () => ({ api: { radar: { attachCandidates: "radar.attachCandidates", pastePlayer: "pp" } } }));
vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWorkspace: () => "real",
}));

import AttachPage from "./page";

const payload = { player: "https://bandcamp.com/EmbeddedPlayer/v=2/album=3847473100/size=large/", art: "https://f4.bcbits.com/img/a1234567890_5.jpg", title: "Reset, by Versa", page: "https://deepheads.bandcamp.com/album/reset" };
afterEach(() => {
  cleanup();
  paste.mockClear();
  window.location.hash = "";
});

describe("Release radar: attach from Bandcamp (bookmarklet)", () => {
  it("lists the matching release and Attach saves the player, cover and page", async () => {
    window.location.hash = encodeURIComponent(JSON.stringify(payload));
    render(<AttachPage />);
    expect(await screen.findByText(/Versa – Reset/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach to Versa – Reset" }));
    await waitFor(() => expect(paste).toHaveBeenCalledWith({ releaseId: "r1", pasted: payload.player, art: payload.art, page: payload.page }));
    expect(await screen.findByText(/Attached/)).toBeInTheDocument();
  });
  it("with no payload it explains how to install the button, with a draggable link", async () => {
    render(<AttachPage />);
    expect(await screen.findByText(/drag/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send to Air Check" }).getAttribute("href")).toMatch(/^javascript:/);
  });
});
