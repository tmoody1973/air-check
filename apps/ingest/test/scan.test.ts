import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { draftPass } from "../src/draft.js";
import { dated, newMemory, readBox, readDrive, readPaper, rescanIfAsked, runScan, type Names } from "../src/scan.js";
import { json } from "./fakes.js";
import { DRIVE_DOCS, NOTES_SECRET, PAPER_DOCS, world } from "./world.js";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});
const make = async (o: Parameters<typeof world>[0] = {}) => {
  const w = await world(o);
  close = w.close;
  return w;
};
const byDate = (w: Awaited<ReturnType<typeof world>>) => Object.fromEntries(w.cv.upserts.map((e) => [e.showDate, e]));

describe("scan: Box + Drive + Paper → one episode per 2026 show date", () => {
  test("stores each 2026 show once, with reconciled tracks, notes for the draft, and plain questions", async () => {
    const w = await make();
    await runScan(w.deps);
    const eps = byDate(w);
    expect(Object.keys(eps).sort()).toEqual(["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30"]);

    const jan2 = eps["2026-01-02"]!;
    expect(jan2.audio).toEqual({
      status: "ready", folderId: "201", pattern: "9125-9126", flags: [],
      hour1: { id: "1001", name: "9125.wav", size: 600_000_000 }, hour2: { id: "1002", name: "9126.wav", size: 600_000_000 },
    });
    // Rule 7: the doc with HOUR 1 / HOUR 2 wins over the show-prep doc; the title line above HOUR 1 is not a track.
    expect(jan2.tracklist.docId).toBe("g1");
    expect(jan2.tracklist.tracks!.map((t) => [t.hour, t.artist, t.title, t.status])).toEqual([
      [1, "Alfa Mist", "Organic Rust", "confirmed"], [1, "Nala Sinephro", "Space 1", "closing-track"],
      [2, "Kokoroko", "Abusey Junction", "confirmed"], [2, "Yussef Dayes", "Black Classical Music", "closing-track"],
    ]);
    expect(jan2.notes).toMatchObject({ status: "found", docId: "id:p1" });
    expect(jan2.notes.text).toContain(NOTES_SECRET); // the draft's input (Hard Rule 12: Convex keeps it private)
    expect(jan2.questions).toEqual([]);
    expect(jan2.audioOnDisk).toBe(false);

    // Paper offers html only → unreadable → a question, never a silent "no notes" (R2).
    const jan9 = eps["2026-01-09"]!;
    expect(jan9.notes).toEqual({ status: "found", docId: "id:p2" });
    expect(jan9.questions.map((q) => q.kind)).toEqual(["tracklist"]);
    expect(jan9.questions[0]!.text).toMatch(/notes for 2026-01-09 could not be read/i);
    expect(jan9.tracklist.tracks!.every((t) => t.status === "unverified-in-notes" || t.status === "closing-track")).toBe(true);

    // Review Focus 1: a RECAP folder is an audio question, never a match.
    const jan16 = eps["2026-01-16"]!;
    expect(jan16.audio).toMatchObject({ status: "ask", folderId: "203" });
    expect(jan16.audio.hour1).toBeUndefined();
    expect(jan16.questions.map((q) => q.kind)).toEqual(["audio"]);

    // One hour empty → a tracklist question; no Paper doc is only a gap.
    const jan23 = eps["2026-01-23"]!;
    expect(jan23.audio.status).toBe("ready");
    expect(jan23.notes).toEqual({ status: "missing" });
    expect(jan23.questions.map((q) => q.text)).toEqual([expect.stringMatching(/no Hour 2 tracks/)]);

    expect(eps["2026-01-30"]!.questions).toEqual([]);
    expect(w.cv.lastSource("box")).toEqual({ source: "box", state: "connected" });
    expect(w.cv.lastSource("google")).toEqual({ source: "google", state: "connected", account: "Google account" });
    expect(w.cv.lastSource("dropbox")).toEqual({ source: "dropbox", state: "connected", account: "Dropbox account" });
  });

  test("question ids are stable across scans (so answers carry over) and two scans store the same facts", async () => {
    const w = await make();
    await runScan(w.deps);
    const first = byDate(w);
    w.cv.upserts.length = 0;
    await runScan(w.deps);
    expect(byDate(w)).toEqual(first);
    // Status rows are sent only when they change.
    expect(w.cv.sources).toHaveLength(3);
  });

  test("never follows a link in a doc, never touches anything but the three APIs", async () => {
    const w = await make();
    await runScan(w.deps);
    expect(w.dl.seen).toEqual([]); // a scan downloads nothing
    for (const s of [w.box, w.google, w.dropbox]) expect(s.seen.every((x) => !x.path.includes("evil"))).toBe(true);
  });
});

describe("scan: a source that is missing, expired or revoked (Review Focus 3, R13)", () => {
  test.each(["google", "dropbox"] as const)("%s token file missing → not_connected; the other sources are still read; shows are stored with that column missing (R14)", async (p) => {
    const w = await make({ [`${p}Token`]: undefined });
    await runScan(w.deps);
    expect(w.cv.lastSource(p)).toEqual({ source: p, state: "not_connected", lastError: "no_token" });
    expect(w.cv.lastSource("box")!.state).toBe("connected");
    expect(w.cv.lastSource(p === "google" ? "dropbox" : "google")!.state).toBe("connected");
    expect(w.box.calls("GET /2.0/folders/123/items")).toHaveLength(1);
    expect(w.cv.upserts).toHaveLength(5);
    for (const e of w.cv.upserts) expect(p === "google" ? e.tracklist : e.notes).toEqual({ status: "missing" });
    expect(w.deps.memory.lastScanComplete).toBe(true); // not connected is not a failure: drafting goes on
    expect(w.logs.some((l) => /^ingest step=scan ok=true stored=5 /.test(l))).toBe(true);
  });

  test.each(["google", "dropbox"] as const)("%s refuses the refresh (invalid_grant) → needs_reconnect, tried once, retried only after a Reconnect", async (p) => {
    const refuse = (_: unknown, res: Parameters<typeof json>[0]) => json(res, 400, { error: "invalid_grant" });
    const w = await make({ [`${p}TokenRoute`]: refuse });
    const server = p === "google" ? w.google : w.dropbox;
    const tokenKey = p === "google" ? "POST /token" : "POST /oauth2/token";
    await runScan(w.deps);
    expect(w.cv.lastSource(p)).toEqual({ source: p, state: "needs_reconnect", account: `${p === "google" ? "Google" : "Dropbox"} account`, lastError: "invalid_grant" });
    await runScan(w.deps);
    await runScan(w.deps);
    expect(server.calls(tokenKey)).toHaveLength(1); // no loop: the refused token is remembered (by hash)
    expect(w.cv.sources.filter((s) => s.source === p)).toHaveLength(1);
    // R14: a connected source failing. First scan (nothing stored yet): the new shows are stored; later scans leave
    // them alone (no earlier good read to merge), and nothing is drafted meanwhile.
    expect(w.cv.upserts).toHaveLength(5);
    expect(w.deps.memory.lastScanComplete).toBe(false);
    expect(w.box.calls("GET /2.0/folders/123/items")).toHaveLength(3); // Box is still scanned every time

    await w.write(`${p}.json`, { refresh_token: "new-refresh", account: "x", connectedAt: 2 }); // Reconnect in Settings
    await runScan(w.deps);
    expect(server.calls(tokenKey)).toHaveLength(2);
  });

  test("a half-written token file is needs_reconnect, not a guess", async () => {
    const w = await make({ googleToken: "{\"refresh_tok" });
    await runScan(w.deps);
    expect(w.cv.lastSource("google")).toEqual({ source: "google", state: "needs_reconnect", lastError: "invalid_token_file" });
  });

  test.skipIf(process.getuid?.() === 0)("M4: a token file ingest can't read (wrong owner) is unreadable_token_file, not needs_reconnect; nothing is drafted", async () => {
    const w = await make();
    await chmod(join(w.deps.tokenDir, "google.json"), 0);
    await runScan(w.deps);
    expect(w.cv.lastSource("google")).toEqual({ source: "google", state: "connected", lastError: "unreadable_token_file" });
    expect(w.deps.memory.lastScanComplete).toBe(false);
  });

  test("Box not configured → not_connected; Box refusing the client credentials → needs_reconnect, tried once per scan", async () => {
    const w = await make({ box: false });
    await runScan(w.deps);
    expect(w.cv.lastSource("box")).toEqual({ source: "box", state: "not_connected", lastError: "not_configured" });
    expect(w.cv.upserts).toHaveLength(4); // 2026-01-16 exists only as a Box folder
    for (const e of w.cv.upserts) expect(e.audio).toEqual({ status: "none", flags: [] });

    const v = await make({ boxToken: (_, res) => json(res, 400, { error: "invalid_client" }) });
    await runScan(v.deps);
    await runScan(v.deps);
    expect(v.cv.lastSource("box")).toEqual({ source: "box", state: "needs_reconnect", lastError: "invalid_client" });
    expect(v.box.calls("POST /oauth2/token")).toHaveLength(2); // no Reconnect button: an admin's fix needs no restart
    expect(v.cv.sources.filter((s) => s.source === "box")).toHaveLength(1);
    expect(v.google.calls("GET /drive/v3/files")).toHaveLength(2);
  });

  test("a provider that is merely down (500) is skipped this scan without changing its status", async () => {
    const w = await make({ dropboxTokenRoute: (_, res) => json(res, 503, {}) });
    await runScan(w.deps);
    expect(w.cv.lastSource("dropbox")).toBeUndefined();
    expect(w.deps.memory.lastScanComplete).toBe(false);
    expect(w.logs).toContain("ingest step=scan source=dropbox ok=false error=http_503");
  });
});

describe("Hard Rule 8 / 12: logs", () => {
  test("carry dates, steps, counts and timings only: never notes, doc names, file names or tokens", async () => {
    const w = await make();
    await runScan(w.deps);
    const all = w.logs.join("\n");
    expect(w.logs.length).toBeGreaterThan(0);
    for (const secret of [NOTES_SECRET, "Alfa Mist", "Rhythm Lab Radio", "9125.wav", "g-refresh", "d-refresh", "box-access", "g-access", "bsecret", "http://", "id:p1"])
      expect(all, secret).not.toContain(secret);
    for (const line of w.logs) expect(line).toMatch(/^ingest( date=\d{4}-\d{2}-\d{2})?( [a-z_]+=[\w.-]+)+$/);
  });
});

describe("R14: a source not connected is missing; a connected source that fails keeps its previous facts", () => {
  const draftDeps = (w: Awaited<ReturnType<typeof world>>) => ({ convex: w.cv.convex, log: w.deps.log, last: { key: "" }, scan: w.deps.memory });

  test("Dropbox not connected → every episode stored with notes missing, and a ready show is still drafted", async () => {
    const w = await make({ dropboxToken: undefined });
    await runScan(w.deps);
    const eps = byDate(w);
    expect(Object.keys(eps).sort()).toEqual(["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30"]);
    for (const e of Object.values(eps)) expect(e.notes).toEqual({ status: "missing" });
    expect(eps["2026-01-02"]!.tracklist.status).toBe("found");
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls.map((c) => [c.showDate, c.outcome.queued])).toEqual([["2026-01-02", true]]);
  });

  test("Dropbox connected but its list 500s → previous notes kept on upsert, no draft this pass; the next good scan resumes drafting", async () => {
    let listOk = true;
    const w = await make({ dropboxList: () => listOk });
    await runScan(w.deps);
    w.cv.upserts.length = 0;
    listOk = false;
    await runScan(w.deps);
    const jan2 = byDate(w)["2026-01-02"]!;
    expect(jan2.notes).toMatchObject({ status: "found", docId: "id:p1" });
    expect(jan2.notes.text).toContain(NOTES_SECRET);
    expect(jan2.tracklist.tracks!.map((t) => t.status)).toEqual(["confirmed", "closing-track", "confirmed", "closing-track"]);
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls).toEqual([]);
    expect(w.logs).toContain("ingest step=scan source=dropbox ok=false error=http_500");

    listOk = true;
    await runScan(w.deps);
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls.map((c) => c.showDate)).toEqual(["2026-01-02"]);
  });

  test("after a restart (nothing remembered), a failing source leaves stored shows untouched and drafting paused", async () => {
    let listOk = true;
    const w = await make({ dropboxList: () => listOk });
    await runScan(w.deps);
    w.cv.upserts.length = 0;
    listOk = false;
    w.deps.memory = newMemory();
    await runScan(w.deps);
    expect(w.cv.upserts).toEqual([]);
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls).toEqual([]);
  });

  test("a fresh process drafts nothing before its first complete scan", async () => {
    const w = await make();
    await runScan(w.deps); // shows stored by the last process
    w.deps.memory = newMemory(); // restart
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls).toEqual([]);
    await runScan(w.deps);
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls).toHaveLength(1);
  });
});

describe("one unreadable doc is that show's question, not a failed source (fix round 1)", () => {
  const draftDeps = (w: Awaited<ReturnType<typeof world>>) => ({ convex: w.cv.convex, log: w.deps.log, last: { key: "" }, scan: w.deps.memory });

  test.each([
    ["a Drive export 403", { googleRoutes: { "GET /drive/v3/files/g1/export": (_: unknown, res: Parameters<typeof json>[0]) => json(res, 403, { error: "cannotExportFile" }) } }],
    ["a Drive doc over 1 MB", { googleRoutes: { "GET /drive/v3/files/g1/export": (_: unknown, res: Parameters<typeof json>[0]) => { res.writeHead(200); res.end("x".repeat(1024 ** 2 + 1)); } } }],
    ["a Dropbox get_metadata 400", { dropboxRoutes: { "POST /2/files/get_metadata": (req: { body: string }, res: Parameters<typeof json>[0]) => {
      const path = JSON.parse(req.body).path as string;
      return path === "id:p1" ? json(res, 400, { error_summary: "path/malformed/" }) : json(res, 200, { id: path, export_info: { export_options: PAPER_DOCS[path]!.options } });
    } } }],
  ])("%s → that show gets a 'could not be read' question; the source stays connected and other shows still draft", async (_n, o) => {
    const w = await make(o as Parameters<typeof world>[0]);
    await runScan(w.deps);
    const jan2 = byDate(w)["2026-01-02"]!;
    expect(jan2.questions.map((q) => [q.kind, /could not be read/.test(q.text)])).toContainEqual(["tracklist", true]);
    expect(w.deps.memory.lastScanComplete).toBe(true);
    for (const p of ["box", "google", "dropbox"] as const) expect(w.cv.lastSource(p)!.state).toBe("connected");
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls.map((c) => [c.showDate, c.outcome.queued])).toEqual([["2026-01-30", true]]);
  });

  test.each(["rateLimitExceeded", "userRateLimitExceeded"])("M5: a Drive export 403 %s is throttling: the source fails this pass, previous facts kept, no question", async (reason) => {
    let limited = false;
    const w = await make({ googleRoutes: { "GET /drive/v3/files/g1/export": (_: unknown, res: Parameters<typeof json>[0]) => {
      if (limited) return json(res, 403, { error: { code: 403, message: "secret-ish text", errors: [{ domain: "usageLimits", reason }] } });
      res.writeHead(200);
      res.end(DRIVE_DOCS.g1!.text);
    } } });
    await runScan(w.deps);
    w.cv.upserts.length = 0;
    limited = true;
    await runScan(w.deps);
    expect(w.deps.memory.lastScanComplete).toBe(false);
    const jan2 = byDate(w)["2026-01-02"]!;
    expect(jan2.questions.filter((q) => /could not be read/.test(q.text))).toEqual([]);
    expect(jan2.tracklist.status).toBe("found");
    expect(w.cv.lastSource("google")!.state).toBe("connected");
    expect(w.logs).toContain("ingest step=scan source=google ok=false error=rate_limited");
    expect(w.logs.join("\n")).not.toContain("secret-ish");
  });

  test("a Drive list call failing still fails the source (R14: previous facts kept, no draft)", async () => {
    const w = await make({ googleRoutes: { "GET /drive/v3/files": (_, res) => json(res, 403, {}) } });
    await runScan(w.deps);
    expect(w.deps.memory.lastScanComplete).toBe(false);
  });
});

describe("I3: rows for dates no source has any more are pruned, only after a complete scan", () => {
  const stale = (w: Awaited<ReturnType<typeof world>>, ...dates: string[]) => {
    for (const d of dates) w.cv.rows.set(d, { ...structuredClone(w.cv.rows.get("2026-01-30")!), showDate: d });
  };

  test("R18: a not-connected source blocks prune, even when a stored date is absent", async () => {
    const w = await make({ googleToken: undefined });
    await runScan(w.deps);
    stale(w, "2026-02-27");
    await runScan(w.deps);
    expect(w.cv.prunes).toEqual([]);
    expect(w.cv.rows.has("2026-02-27")).toBe(true);
  });

  test("a scan that read all three sources prunes to the dates it found", async () => {
    const w = await make();
    await runScan(w.deps);
    stale(w, "2026-02-27"); // its doc was renamed to another date
    await runScan(w.deps);
    expect(w.cv.prunes.at(-1)).toEqual(["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30"]);
    expect(w.cv.rows.has("2026-02-27")).toBe(false);
    expect(w.logs).toContain("ingest step=prune ok=true deleted=1");
  });

  test("no prune after a scan where a connected source failed", async () => {
    let listOk = true;
    const w = await make({ dropboxList: () => listOk });
    await runScan(w.deps);
    const n = w.cv.prunes.length;
    stale(w, "2026-02-27");
    listOk = false;
    await runScan(w.deps);
    expect(w.cv.prunes).toHaveLength(n);
    expect(w.cv.rows.has("2026-02-27")).toBe(true);
  });

  test("more than 3 rows to remove: none removed, and the log says how many (counts only)", async () => {
    const w = await make();
    await runScan(w.deps);
    stale(w, "2026-02-06", "2026-02-13", "2026-02-20", "2026-02-27");
    await runScan(w.deps);
    expect(w.cv.rows.has("2026-02-27")).toBe(true);
    expect(w.logs).toContain("ingest step=prune skipped=true count=4");
  });
});

describe("Plan 6b: names that can't be dated are listed, and a placement dates them", () => {
  const MB = 1_000_000;
  const extra = {
    box: { "9-4-226": { id: "209", files: [{ type: "file", id: "1091", name: "9125.wav", size: 600 * MB }] }, "Rhythm Lab Radio 11": { id: "210", files: [] } },
    drive: { g9: { name: "Rhythm Lab Radio 9-4-226", text: "HOUR 1\nA - \"One\"\nHOUR 2\nB - \"Two\"\n" }, g11: { name: "Rhythm Lab Radio 11", text: "old" } },
    paper: { "id:p9": { name: "Rhythm Lab Radio 9-4-226.paper", options: ["markdown"], text: "notes" }, "id:p11": { name: "Rhythm Lab Radio 11.paper", options: ["markdown"], text: "old" } },
  };
  const names = (placements: Names["placements"] = []): Names => ({ placements, unplaced: [] });
  const cases = [
    ["paper", "id:p9", "Rhythm Lab Radio 9-4-226.paper", readPaper],
    ["drive", "g9", "Rhythm Lab Radio 9-4-226", readDrive],
    ["box", "209", "9-4-226", readBox],
  ] as const;

  test.each(cases)("%s: an undated name is reported (not 'no date at all'); placed, it becomes that show's", async (source, id, name, read) => {
    const w = await make({ extra });
    const n = names();
    const before = await read(w.deps, n);
    expect(n.unplaced).toEqual([{ source, id, name, reason: expect.stringMatching(/year "226" is not 2 or 4 digits/) }]);
    expect(before instanceof Map && [...before.values()].flat().some((x) => x.id === id)).toBe(false);

    const placed = names([{ source, id, date: "2026-09-04" }]);
    const after = await read(w.deps, placed);
    expect(placed.unplaced).toEqual([]);
    expect(after instanceof Map && (after.get("2026-09-04") as { id: string }[]).map((x) => x.id)).toEqual([id]);
  });

  test("a placement for another source's id is not used", async () => {
    const w = await make({ extra });
    const n = names([{ source: "drive", id: "id:p9", date: "2026-09-04" }]);
    const r = await readPaper(w.deps, n);
    expect(r instanceof Map && r.has("2026-09-04")).toBe(false);
    expect(n.unplaced.map((u) => u.id)).toEqual(["id:p9"]);
  });

  test("a Box folder placed on a date keeps its WAVs for the hours choice", async () => {
    const w = await make({ extra });
    const r = await readBox(w.deps, names([{ source: "box", id: "209", date: "2026-09-04" }]));
    expect(r instanceof Map && r.get("2026-09-04")![0]!.wavs.map((f) => f.id)).toEqual(["1091"]);
    expect(r instanceof Map && r.get("2026-01-02")![0]!.wavs.map((f) => f.name)).toEqual(["9125.wav", "9126.wav", "9101.wav"]);
  });

  test("at most 50 are listed per scan; a datable name and an older year are not listed", () => {
    const n = names();
    for (let i = 0; i < 60; i++) dated("drive", `Rhythm Lab Radio 9-4-${100 + i}`, `d${i}`, n);
    expect(n.unplaced).toHaveLength(50);
    const m = names();
    expect(dated("drive", "Rhythm Lab Radio 9-4-26", "a", m)).toBe("2026-09-04");
    expect(dated("drive", "Rhythm Lab Radio 9-4-25", "b", m)).toBeNull();
    expect(dated("drive", "Rhythm Lab Radio 11", "c", m)).toBeNull();
    expect(m.unplaced).toEqual([]);
  });
});

describe("Plan 6b: the scanner applies corrections and rescans after a save", () => {
  const draftDeps = (w: Awaited<ReturnType<typeof world>>) => ({ convex: w.cv.convex, log: w.deps.log, last: { key: "" }, scan: w.deps.memory });
  const scans = (w: Awaited<ReturnType<typeof world>>) => w.box.calls("GET /2.0/folders/123/items").length;
  const tick = () => new Promise((r) => setTimeout(r, 3));
  const typed = "HOUR 1\nA - \"One\"\nB - \"Two\"\nHOUR 2\nC - \"Three\"\nD - \"Four\"\n";

  test("a typed tracklist reaches the stored row: its tracks, no tracklist questions, and the correction it applied", async () => {
    const w = await make();
    w.cv.corrections.set("2026-01-23", { showDate: "2026-01-23", tracklistText: typed, updatedAt: 41 });
    await runScan(w.deps);
    const eps = byDate(w);
    const jan23 = eps["2026-01-23"]!;
    expect(jan23.tracklist).toMatchObject({ status: "found", docId: "air-check" });
    expect(jan23.tracklist.tracks!.map((t) => [t.hour, t.artist, t.title])).toEqual([[1, "A", "One"], [1, "B", "Two"], [2, "C", "Three"], [2, "D", "Four"]]);
    expect(jan23.questions.filter((q) => q.kind === "tracklist")).toEqual([]);
    expect(jan23.appliedCorrectionAt).toBe(41);
    expect(eps["2026-01-02"]!.appliedCorrectionAt).toBeUndefined();
    expect((await w.cv.convex.list()).episodes.some((r) => r.rescanPending)).toBe(false);
  });

  test("a stale correction logs its date and step only, and is still sent as seen (no endless 'checking your fix')", async () => {
    const w = await make();
    w.cv.corrections.set("2026-01-02", { showDate: "2026-01-02", drive: "gone-doc", updatedAt: 7 });
    await runScan(w.deps);
    const jan2 = byDate(w)["2026-01-02"]!;
    expect(jan2.correctionStale).toBe(true);
    expect(jan2.appliedCorrectionAt).toBe(7);
    expect(w.logs).toContain("ingest date=2026-01-02 step=correction stale=true");
    const line = w.logs.find((l) => l.includes("step=correction"))!;
    for (const secret of ["gone-doc", "g1", "Rhythm Lab Radio"]) expect(line).not.toContain(secret);
    for (const l of w.logs) expect(l).toMatch(/^ingest( date=\d{4}-\d{2}-\d{2})?( [a-z_]+=[\w.-]+)+$/);
  });

  test("placements from Convex date an undated name; undated names are reported after a complete scan only", async () => {
    let listOk = true;
    const w = await make({ extra: { drive: { g9: { name: "Rhythm Lab Radio 9-4-226", text: "HOUR 1\nA - \"One\"\nHOUR 2\nB - \"Two\"\n" } } }, dropboxList: () => listOk });
    await runScan(w.deps);
    expect(w.cv.unplacedReports).toEqual([[{ source: "drive", id: "g9", name: "Rhythm Lab Radio 9-4-226", reason: expect.any(String) }]]);
    expect(w.cv.rows.has("2026-09-04")).toBe(false);

    w.cv.placements.push({ source: "drive", id: "g9", date: "2026-09-04", updatedAt: 5 });
    await runScan(w.deps);
    expect(w.cv.rows.get("2026-09-04")!.tracklist.docId).toBe("g9");
    expect(w.cv.unplacedReports.at(-1)).toEqual([]);

    listOk = false; // a connected source failed: its names are unknown, so the list is not replaced
    await runScan(w.deps);
    expect(w.cv.unplacedReports).toHaveLength(2);
  });

  test("a save starts one rescan within a pass; five saves still one; nothing new, no scan", async () => {
    const w = await make();
    await runScan(w.deps);
    await rescanIfAsked(w.deps);
    expect(scans(w)).toBe(1);

    await tick();
    for (const d of ["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30"]) w.cv.corrections.set(d, { showDate: d, drive: "x", updatedAt: Date.now() });
    await tick();
    await rescanIfAsked(w.deps);
    expect(scans(w)).toBe(2);
    await rescanIfAsked(w.deps);
    expect(scans(w)).toBe(2);

    await tick();
    w.cv.undo(Date.now()); // "Use Drive again" leaves no correction to compare, but still asks for a scan
    await tick();
    await rescanIfAsked(w.deps);
    expect(scans(w)).toBe(3);
  });

  test("a pass while the hourly scan runs starts no second scan; the next pass catches the save up", async () => {
    const w = await make();
    const hourly = runScan(w.deps);
    w.cv.corrections.set("2026-01-23", { showDate: "2026-01-23", tracklistText: typed, updatedAt: w.deps.memory.lastScanStartedAt + 1 });
    await Promise.all([rescanIfAsked(w.deps), runScan(w.deps)]);
    await hourly;
    expect(scans(w)).toBe(1);
    expect(w.cv.rows.get("2026-01-23")!.appliedCorrectionAt).toBeUndefined(); // the hourly scan read before the save

    await tick();
    await rescanIfAsked(w.deps);
    expect(scans(w)).toBe(2);
    expect(w.cv.rows.get("2026-01-23")!.appliedCorrectionAt).toBe(w.cv.corrections.get("2026-01-23")!.updatedAt);
    expect(w.deps.memory.scanning).toBe(false);
  });

  test("the draft pass skips a show waiting for its rescan, so it does not hold up the queue", async () => {
    const w = await make();
    await runScan(w.deps);
    w.cv.corrections.set("2026-01-02", { showDate: "2026-01-02", paper: "id:p1", updatedAt: Date.now() + 60_000 });
    await draftPass(draftDeps(w));
    expect(w.cv.draftCalls.map((c) => [c.showDate, c.outcome.queued])).toEqual([["2026-01-30", true]]);
  });
});
