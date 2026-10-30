// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { ClaimLine } from "./ClaimLine";
import { claim, src } from "./research.fixture";

afterEach(cleanup);

describe("ClaimLine", () => {
  it("sources are host chips that link out, never followed by the page", () => {
    render(<ClaimLine claim={claim({ text: "On [Label A].", sources: [src("a1", "musicbrainz.org")] })} />);
    const link = screen.getByRole("link", { name: "musicbrainz.org" });
    expect(link).toHaveAttribute("href", "https://musicbrainz.org/a1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link).toHaveAttribute("target", "_blank");
    // The chip stays small; its hit area reaches 44 px (R12).
    expect(link).toHaveClass("relative", "after:absolute", "after:-inset-y-2.5");
  });

  it("a non-http source is shown as text, never a link", () => {
    render(<ClaimLine claim={claim({ text: "x", sources: [{ ...src("a"), url: "javascript:alert(1)", host: "evil" }] })} />);
    expect(screen.getByText("evil")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("[verify] claims show the code-written check; model text stays plain text", () => {
    render(<ClaimLine claim={claim({ text: "<b>Out</b> Oct 9 https://x.example", status: "conflict", check: "Sources disagree: 2026-10-09 vs 2026-10-16" })} />);
    expect(screen.getByText("[verify]")).toHaveClass("bg-caution-bg");
    expect(screen.getByText(/Sources disagree: 2026-10-09 vs 2026-10-16/)).toBeInTheDocument();
    expect(screen.getByText("<b>Out</b> Oct 9 https://x.example")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /x\.example/ })).not.toBeInTheDocument();
  });
});
