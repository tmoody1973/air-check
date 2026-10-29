import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentPackageInput, buildTitle, DESCRIPTION_SKILL_TEXT, titleLeadsBudget, applyRunEvent, buildPackageDraft, formatTrack, draftPackageInput, initialRun, parseAuditLine, RESEARCH_SKILL_TEXT, researchInput, type ResearchTrack, RUN_INSTRUCTIONS, numberLines, showNotesMarkdown } from "../src/index";
import { sampleView } from "./helpers/researchSample";
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
  it("R9: tells the agent Air Check fills the tracklist; never to retype it exactly", () => {
    expect(out).toContain("Air Check fills the package's tracklist from this draft request");
    expect(out).not.toMatch(/tracklistText \(exactly as given\)|tracklist exactly as given/);
  });
  it("carries the description skill under its own heading, and no station opening line", () => {
    expect(out).toContain("How to write the description (station skill rlr-description-safety)");
    expect(out).toContain(DESCRIPTION_SKILL_TEXT);
    expect(out).not.toMatch(/week of|hosted by/i);
    // The skill sits before the untrusted inputs, so nothing in the notes can pose as part of it.
    expect(out.indexOf(DESCRIPTION_SKILL_TEXT)).toBeLessThan(out.indexOf("TRACKLIST"));
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
    expect(RUN_INSTRUCTIONS).toMatch(/rlr-mixcloud-title-and-tags skill/);
    expect(RUN_INSTRUCTIONS).toMatch(/rlr-description-safety skill/);
    expect(RUN_INSTRUCTIONS).toMatch(/descriptionSources/);
    expect(RUN_INSTRUCTIONS).toMatch(/package_get before revising/);
    // Plan 7 added the source_search sentence (977 characters then); the cap stays well under Hermes's limit.
    expect(RUN_INSTRUCTIONS.length).toBeLessThan(1000);
    expect(RUN_INSTRUCTIONS).toMatch(/source_search/);
    expect(RUN_INSTRUCTIONS).toMatch(/never write or save skills/);
    expect(RUN_INSTRUCTIONS).not.toContain(DESCRIPTION_SKILL_TEXT.slice(0, 40));
  });
});

describe("researchInput", () => {
  const T = (key: string, artist: string, title: string, closing = false): ResearchTrack => {
    const [h, p] = key.slice(1).split(".").map(Number);
    return { key, hour: h as 1 | 2, position: p!, artist, title, closing };
  };
  const tracks = [T("H1.1", "Opener Artist", "First"), T("H1.2", "Second Artist", "Middle"), T("H1.15", "Closer Artist", "Last Song", true), T("H2.1", "Third Artist", "Late")];
  const job = { jobId: "rj-abc123", kind: "show-notes" as const, showDate: "2026-10-30", tracks, keys: ["H1.intro", "H1.1", "H2.1"], angles: true, searchesLeft: 7 };

  it("lists only the keys still to do, a closing track as skipped by key only, the searches left and the skill (Review Focus 3)", () => {
    const text = researchInput(job);
    expect(text).toContain("rj-abc123");
    expect(text).toContain("H1.1 Opener Artist – \"First\"");
    expect(text).toContain("H1.intro");
    expect(text).toContain("H1.15 · closing track, skipped");
    expect(text.match(/H1\.15/g)).toHaveLength(1);
    expect(text).not.toContain("Closer Artist");
    expect(text).not.toContain("Second Artist");
    expect(text).toContain("7 web searches left today");
    expect(text).toMatch(/Crate first/);
    expect(text).toMatch(/untrusted/);
    expect(text).toContain("If research_submit refuses twice for the same key, skip it and move on");
    expect(text).toContain("never send artist, title or URL fields");
    expect(text).toContain(RESEARCH_SKILL_TEXT["show-notes"]);
    expect(text).toMatch(/On-air angle|angle/);
  });

  it("does not ask for angles when they are off", () => {
    expect(researchInput({ ...job, angles: false })).toMatch(/Do not write angles/);
  });

  it("keeps an embargoed track off web search without saying why (R2, R8)", () => {
    const text = researchInput({ ...job, embargoes: [{ artist: "Third Artist", title: "Late", until: "2026-11-06" }] });
    const keyPart = text.slice(text.indexOf(RESEARCH_SKILL_TEXT["show-notes"]) + RESEARCH_SKILL_TEXT["show-notes"].length);
    expect(keyPart).toContain("H2.1 Third Artist – \"Late\" · Crate only, no source_search");
    expect(keyPart).not.toContain("H1.1 Opener Artist – \"First\" · Crate only");
    expect(keyPart).not.toMatch(/embargo|2026-11-06/i);
  });

  it("offers a verify job its line ids, never a closing track's lines, and no embargo marker from Air Check's own notes (D3)", () => {
    const view = { ...sampleView };
    const lines = numberLines(showNotesMarkdown(view, { forAgent: true }), view.tracks);
    const text = researchInput({ jobId: "rj-ver001", kind: "verify", showDate: "2026-10-30", lines, embargoes: view.embargoes, angles: true, searchesLeft: 0 });
    expect(text).toContain(RESEARCH_SKILL_TEXT.verify);
    expect(text).not.toMatch(/embargoed|2026-11-06|date not known/i);
    expect(text).not.toContain("[Artist C]");
    expect(text).not.toContain("[Artist E]");
    expect(text).toMatch(/No web searches left today/);
    const l = lines.find((x) => x.text.startsWith("- [Artist A] co-produced"))!;
    expect(text).toContain(`${l.id} [H1.1] ${l.text}`);
  });

  it("asks a deep dive for one brief block with connections by key", () => {
    const text = researchInput({ jobId: "rj-dd0001", kind: "deep-dive", subject: { type: "label", name: "[Label A]" }, tracks, angles: true, searchesLeft: 3 });
    expect(text).toContain("[Label A]");
    expect(text).toContain("brief");
    expect(text).toContain("H1.15 · closing track, skipped");
    expect(text).not.toContain("Closer Artist");
    expect(text).toContain(RESEARCH_SKILL_TEXT["deep-dive"]);
  });
});
