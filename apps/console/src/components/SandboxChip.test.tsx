// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxChip, STALE_MS } from "./SandboxChip";

afterEach(cleanup);
const NOW = 1_800_000_000_000;
const show = (row: { phase: string | null; allowedHosts: number; at: number } | null | undefined) => render(<SandboxChip row={row} now={NOW} />);

describe("SandboxChip", () => {
  it("says on with the host count when Ready and fresh", () => {
    show({ phase: "Ready", allowedHosts: 10, at: NOW - 1000 });
    expect(screen.getByText("Sandbox on · 10 hosts allowed")).toBeInTheDocument();
  });
  it("uses '1 host' for one", () => {
    show({ phase: "Ready", allowedHosts: 1, at: NOW });
    expect(screen.getByText("Sandbox on · 1 host allowed")).toBeInTheDocument();
  });
  it("is still on at exactly 15 minutes, unknown one millisecond later", () => {
    expect(STALE_MS).toBe(15 * 60_000);
    show({ phase: "Ready", allowedHosts: 3, at: NOW - STALE_MS });
    expect(screen.getByText("Sandbox on · 3 hosts allowed")).toBeInTheDocument();
    cleanup();
    show({ phase: "Ready", allowedHosts: 3, at: NOW - STALE_MS - 1 });
    expect(screen.getByText("Sandbox status unknown")).toBeInTheDocument();
  });
  it.each([["null row", null], ["loading", undefined], ["other phase", { phase: "Provisioning", allowedHosts: 3, at: NOW }], ["null phase", { phase: null, allowedHosts: 3, at: NOW }]])("unknown for %s", (_n, row) => {
    show(row);
    expect(screen.getByText("Sandbox status unknown")).toBeInTheDocument();
  });
});
