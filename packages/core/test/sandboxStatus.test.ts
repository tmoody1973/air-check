import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSandboxStatus } from "../src/index";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

describe("parseSandboxStatus", () => {
  it("reads the real nemohermes fixtures: Ready, 10 distinct hosts (11 lines, 10.104.0.41 twice)", () => {
    const policy = fx("nemohermes-policy.txt");
    expect(policy.match(/- host: /g)).toHaveLength(11);
    expect(parseSandboxStatus(fx("nemohermes-status.txt"), policy)).toEqual({ phase: "Ready", allowedHosts: 10 });
  });
  it("handles empty inputs", () => {
    expect(parseSandboxStatus("", "")).toEqual({ phase: null, allowedHosts: 0 });
  });
  it("returns null phase when there is no Phase line", () => {
    expect(parseSandboxStatus("Sandbox: airc\n  Name: airc\n", "- host: a.example").phase).toBeNull();
  });
  it("counts duplicate hosts once", () => {
    expect(parseSandboxStatus("", "- host: a.example\n  - host: a.example\n- host: b.example\n").allowedHosts).toBe(2);
  });
  it("ignores '- host:' lines in the status text", () => {
    expect(parseSandboxStatus("  Phase:  Provisioning \n- host: x.example\n", "- host: a.example")).toEqual({ phase: "Provisioning", allowedHosts: 1 });
  });
});
