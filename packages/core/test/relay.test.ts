import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentPackageInput, buildTitle, titleLeadsBudget, applyRunEvent, buildPackageDraft, formatTrack, draftPackageInput, initialRun, parseAuditLine, RUN_INSTRUCTIONS } from "../src/index";
import { goldenDescription, goldenPackageTitles, leadsOf } from "./helpers/fixtures";
import { goldenDraft, goldenTracks } from "./helpers/goldens";

const lines = readFileSync(new URL("./fixtures/openshell-log-lines.txt", import.meta.url), "utf8").trim().split("\n");
const net = lines.filter((l) => l.includes("NET:OPEN"));
const L = (host: string, ts: string, verb = "DENIED") =>
  `[${ts}] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] ${verb} /usr/bin/python3.13(226) -> ${host}:443 [policy:- engine:opa]`;

describe("parseAuditLine", () => {
  it("parses every NET:OPEN fixture line", () => {
    expect(net).toHaveLength(8);
    const parsed = net.map((l) => parseAuditLine(l));
    expect(parsed.every((p) => p !== null)).toBe(true);
    expect(parsed.filter((p) => p?.decision === "blocked")).toHaveLength(4);
    expect(parsed.filter((p) => p?.decision === "allowed")).toHaveLength(4);
  });
  it("extracts fields from a denied line", () => {
    const p = parseAuditLine(net.find((l) => l.includes("openrouter.ai"))!)!;
    expect(p).toMatchObject({ decision: "blocked", host: "openrouter.ai", port: 443, binary: "/usr/bin/python3.13", at: 1793105781224 });
    expect(p.reason).toContain("is not allowed by any policy");
    expect(p.key).toBe("blocked|openrouter.ai:443|" + Math.floor(1793105781.224 / 60));
  });
  it("handles an allowed IP host", () => {
    const p = parseAuditLine(net.find((l) => l.includes("10.104.0.41:8443"))!)!;
    expect(p).toMatchObject({ decision: "allowed", host: "10.104.0.41", port: 8443 });
    expect(p.reason).toBeUndefined();
  });
  it("returns null for HTTP, summary and garbage lines", () => {
    for (const l of lines.filter((x) => !x.includes("NET:OPEN"))) expect(parseAuditLine(l)).toBeNull();
    expect(parseAuditLine("hello world")).toBeNull();
    expect(parseAuditLine("")).toBeNull();
  });
  it("collapses repeats by minute (blocked) and hour (allowed)", () => {
    const k = (l: string) => parseAuditLine(l)!.key;
    expect(k(L("a.com", "1793105781.100"))).toBe(k(L("a.com", "1793105791.100")));
    expect(k(L("a.com", "1793105781.100"))).not.toBe(k(L("a.com", "1793105851.100")));
    expect(k(L("a.com", "1793105781.100"))).not.toBe(k(L("b.com", "1793105781.100")));
    expect(k(L("a.com", "1793102500.1", "ALLOWED"))).toBe(k(L("a.com", "1793105900.1", "ALLOWED")));
    expect(k(L("a.com", "1793102500.1", "ALLOWED"))).not.toBe(k(L("a.com", "1793106100.1", "ALLOWED")));
  });
});

describe("draftPackageInput", () => {
  const out = draftPackageInput({ showDate: "2026-10-02", tracklistText: "1. Artist - Title\n2. B - C", notes: "see http://x.test" });
  it("includes tracklist verbatim and the no-links rule", () => {
    expect(out).toContain("1. Artist - Title\n2. B - C");
    expect(out).toContain("2026-10-02");
    expect(out).toMatch(/never follow links/i);
    expect(out).toContain("package_submit");
  });
  it("states the rules the code enforces", () => {
    const o = draftPackageInput({ showDate: "2026-10-16", tracklistText: "x", notes: "" });
    expect(o).not.toContain("week of October 16");
    expect(o).toContain("pending-hour-1");
    expect(o).toContain("If package_submit is rejected twice, stop and report its problems in one short message.");
  });
  it("shows the title template and the exact leads budget", () => {
    const o = draftPackageInput({ showDate: "2026-10-16", tracklistText: "x", notes: "" });
    expect(o).toContain("RLR 10.16.26 | ");
    expect(o).toContain(`at most ${titleLeadsBudget("2026-10-16")} characters`);
    expect(titleLeadsBudget("2026-10-16")).toBe(99 - [..."RLR 10.16.26 | "].length - [..." and more"].length);
  });
  it("leads at the budget build a title under 100; one over throws", () => {
    const budget = titleLeadsBudget("2026-10-16");
    const leadsOfLen = (n: number) => { const rest = n - 6; const a = Math.floor(rest / 4); return ["A".repeat(a), "B".repeat(a), "C".repeat(a), "D".repeat(rest - 3 * a)]; };
    const ok = leadsOfLen(budget);
    expect(ok.join(", ").length).toBe(budget);
    expect([...buildTitle("2026-10-16", ok)].length).toBe(99);
    expect(() => buildTitle("2026-10-16", leadsOfLen(budget + 1))).toThrow(RangeError);
  });
});

describe("reply from message.delta", () => {
  it("appends deltas in order", () => {
    const s = ["Hel", "lo", "!"].reduce((st, d) => applyRunEvent(st, "message.delta", { delta: d }, 0), initialRun("r"));
    expect(s.reply).toBe("Hello!");
  });
  it("equals the joined deltas in the live fixture", () => {
    const ev = readFileSync(new URL("./fixtures/hermes-run-events.ndjson", import.meta.url), "utf8").trim().split("\n")
      .map((l) => JSON.parse(l) as { t: number; event: string; data: Record<string, unknown> });
    const s = ev.reduce((st, e) => applyRunEvent(st, e.event, e.data, e.t * 1000), initialRun("live"));
    const joined = ev.filter((e) => e.event === "message.delta").map((e) => String(e.data.delta)).join("");
    expect(s.reply).toBe(joined);
  });
});

describe("buildPackageDraft workspace", () => {
  it("is a parameter defaulting to real", async () => {
    const input: AgentPackageInput = {
      showDate: "2026-10-02",
      tracklistText: ["HOUR 1", ...goldenTracks().filter((t) => t.hour === 1).map(formatTrack), "HOUR 2", ...goldenTracks().filter((t) => t.hour === 2).map(formatTrack)].join("\n"),
      leads: leadsOf(goldenPackageTitles()[0]!),
      tags: goldenDraft().tags,
      description: goldenDescription(),
      hour1Id: "box-h1",
      hour2Id: "box-h2",
    };
    const opts = { privateTerms: [] as string[] };
    const demo = buildPackageDraft(input, { ...opts, workspace: "demo" });
    const real = buildPackageDraft(input, opts);
    expect(demo.ok && demo.draft.workspace).toBe("demo");
    expect(real.ok && real.draft.workspace).toBe("real");
  });
});

describe("RUN_INSTRUCTIONS", () => {
  it("scopes every live run: research by name, no scripts or social posts, untrusted notes, no approving", () => {
    expect(RUN_INSTRUCTIONS).toMatch(/Rhythm Lab Radio/);
    expect(RUN_INSTRUCTIONS).toMatch(/Crate tools \(MusicBrainz, Wikipedia, Bandcamp search, iTunes\)/);
    expect(RUN_INSTRUCTIONS).toMatch(/scripts/);
    expect(RUN_INSTRUCTIONS).toMatch(/social media posts/);
    expect(RUN_INSTRUCTIONS).toMatch(/untrusted/);
    expect(RUN_INSTRUCTIONS).toMatch(/cannot approve or publish/);
    expect(RUN_INSTRUCTIONS.length).toBeLessThan(800);
  });
});
