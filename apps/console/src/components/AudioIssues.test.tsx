// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { AudioIssues } from "./AudioIssues";

afterEach(cleanup);

describe("AudioIssues", () => {
  it("lists each show whose audio is not ready, with the media service's reason", () => {
    render(
      <AudioIssues
        issues={[
          { showDate: "2026-10-09", reason: "2026-10-09 needs exactly two .wav files; found 1" },
          { showDate: "2026-10-16", reason: "Encoding failed for 2026-10-16; will retry" },
        ]}
      />,
    );
    const card = screen.getByRole("region", { name: "Audio not ready" });
    expect(within(card).getByText("2 shows")).toBeInTheDocument();
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "2026-10-09 needs exactly two .wav files; found 1",
      "Encoding failed for 2026-10-16; will retry",
    ]);
  });

  it("renders nothing while loading or when every show's audio is fine", () => {
    const { container, rerender } = render(<AudioIssues issues={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AudioIssues issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
