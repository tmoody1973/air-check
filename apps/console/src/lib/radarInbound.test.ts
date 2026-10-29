import { readFileSync } from "node:fs";
import { readVerdict } from "@aircheck/core";
import { describe, expect, it, vi } from "vitest";
import { handleInbound, type InboundDeps } from "./radarInbound";

// handleInbound alone: AgentMail and Convex are plain fakes.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../fixtures/email/${name}.json`, import.meta.url), "utf8"));

function deps(served: unknown): InboundDeps & { received: ReturnType<typeof vi.fn> } {
  return {
    token: "t",
    allowlist: ["tarik@radiomilwaukee.org"],
    getMessage: vi.fn(async () => ({ message: served, verdict: readVerdict(served) })),
    received: vi.fn(async () => ({ fresh: true })),
  };
}

describe("handleInbound (R12)", () => {
  it("a listed sender with AgentMail's passing verdict is kept", async () => {
    const m = fixture("cosign-forwarded");
    const d = deps(m);
    expect(await handleInbound(m, d)).toEqual({ status: "stored", fresh: true, kept: true });
    expect(d.received.mock.calls[0]![0].mail).not.toBeNull();
  });

  it("a listed sender whose fetched message has no usable authentication_results is unreadable: nothing written", async () => {
    const m = fixture("cosign-forwarded");
    for (const auth of [undefined, null, "pass", ["pass"]]) {
      const d = deps({ ...m, authentication_results: auth });
      expect(await handleInbound(m, d), String(auth)).toEqual({ status: "unreadable" });
      expect(d.received).not.toHaveBeenCalled();
    }
  });

  it("a present but failing verdict is stored ignored as not confirmed", async () => {
    const m = fixture("cosign-forwarded");
    const d = deps({ ...m, authentication_results: { dmarc: "fail", dmarc_domain: "radiomilwaukee.org" } });
    expect(await handleInbound(m, d)).toEqual({ status: "stored", fresh: true, kept: false, reason: "AgentMail could not confirm the sender" });
  });

  it("a stranger is stored ignored with no AgentMail call", async () => {
    const m = { ...fixture("cosign-forwarded"), from_: "x@evil.example" };
    const d = deps(m);
    expect(await handleInbound(m, d)).toEqual({ status: "stored", fresh: true, kept: false, reason: "Sender not on the list" });
    expect(d.getMessage).not.toHaveBeenCalled();
  });
});
