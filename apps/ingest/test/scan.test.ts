import { afterEach, describe, expect, test } from "vitest";
import { runScan } from "../src/scan.js";
import { json } from "./fakes.js";
import { NOTES_SECRET, world } from "./world.js";

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
  test.each(["google", "dropbox"] as const)("%s token file missing → not_connected; the other sources are still read; nothing is stored", async (p) => {
    const w = await make({ [`${p}Token`]: undefined });
    await runScan(w.deps);
    expect(w.cv.lastSource(p)).toEqual({ source: p, state: "not_connected", lastError: "no_token" });
    expect(w.cv.lastSource("box")!.state).toBe("connected");
    expect(w.cv.lastSource(p === "google" ? "dropbox" : "google")!.state).toBe("connected");
    expect(w.box.calls("GET /2.0/folders/123/items")).toHaveLength(1);
    // A scan without all three sources would overwrite good facts with gaps: it stores nothing.
    expect(w.cv.upserts).toEqual([]);
    expect(w.logs).toContain(`ingest step=scan ok=false reason=${p}_unavailable stored=0`);
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
    expect(w.cv.upserts).toEqual([]);
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

  test("Box not configured → not_connected; Box refusing the client credentials → needs_reconnect, tried once per scan", async () => {
    const w = await make({ box: false });
    await runScan(w.deps);
    expect(w.cv.lastSource("box")).toEqual({ source: "box", state: "not_connected", lastError: "not_configured" });
    expect(w.cv.upserts).toEqual([]);

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
    expect(w.cv.upserts).toEqual([]);
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
