// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const ws = { value: "real" as "real" | "demo" };
vi.mock("./Shell", () => ({ useWorkspace: () => ws.value }));
import { ChatGuide } from "./ChatGuide";

afterEach(cleanup);

describe("ChatGuide", () => {
  it("the station gets examples about its own shows and radar", () => {
    ws.value = "real";
    render(<ChatGuide onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /Jazz Is Dead/ })).toBeInTheDocument();
    expect(screen.queryByText(/In the demo/)).toBeNull();
  });
  it("the demo gets examples about its sample package and says it remembers nothing", () => {
    ws.value = "demo";
    render(<ChatGuide onPick={() => {}} />);
    expect(screen.getByRole("button", { name: "Show me the package for 10.2.26." })).toBeInTheDocument();
    expect(screen.getByText(/remembers nothing between visitors/)).toBeInTheDocument();
  });
});
