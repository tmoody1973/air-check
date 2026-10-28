import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { matchInbox } from "@aircheck/core";
import { afterEach, describe, expect, test } from "vitest";
import { draftPass } from "../src/draft.js";
import { fetchPass, inboxName, MAX_FETCH_FAILURES, RETRY_BACKOFF_MS } from "../src/fetch.js";
import { MB } from "./world.js";
import { runScan } from "../src/scan.js";
import { NOTES_SECRET, world } from "./world.js";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});
const make = async (o: Parameters<typeof world>[0] = {}) => {
  const w = await world(o);
  close = w.close;
  await runScan(w.deps);
  return w;
};
const fetchDeps = (w: Awaited<ReturnType<typeof world>>, now = () => 0) => ({
  convex: w.cv.convex, log: w.deps.log, box: w.deps.box!.client, inboxDir: w.inboxDir, preparedDir: w.preparedDir, failures: new Map<string, { count: number; at: number }>(), now,
});
const downloads = (w: Awaited<ReturnType<typeof world>>) => w.box.seen.filter((s) => s.path.endsWith("/content")).map((s) => s.path.split("/")[3]);

describe("fetch: the next show's audio, on demand (Review Focus 1 and 2)", () => {
  test("downloads the oldest ready show's two hours into inbox/<date>/ so matchInbox orders them, mode 0644", async () => {
    const w = await make();
    await fetchPass(fetchDeps(w));
    expect(downloads(w)).toEqual(["1001", "1002"]);
    const files = (await readdir(join(w.inboxDir, "2026-01-02"))).sort();
    expect(files).toEqual(["1-9125.wav", "2-9126.wav"]);
    expect(matchInbox("2026-01-02", files)).toEqual({ ok: true, showDate: "2026-01-02", hour1: "1-9125.wav", hour2: "2-9126.wav" });
    for (const f of files) expect((await stat(join(w.inboxDir, "2026-01-02", f))).mode & 0o777).toBe(0o644);
    expect(w.cv.fetches).toEqual([{ showDate: "2026-01-02", status: "fetching" }, { showDate: "2026-01-02", status: "fetched" }]);
  });

  test("inbox names put the hour first, whatever Box called the files (29934/29935, RLR - Full Hour 1/2, legacy)", () => {
    const pairs = [
      ["29934_Rhythm Lab Radio hour 1_Tarik Moody_010926.wav", "29935_Rhythm Lab Radio hour 2_Tarik Moody_010926.wav"],
      ["RLR - Full Hour 1 - 012326.wav", "RLR- Full Hour 2 - 012326.wav"],
      ["Hour One (9125).wav", "Hour Two (9126).wav"],
      ["9126.wav", "9125.wav"], // even a swapped pair is ordered by the hour assemble decided, not by the name
    ];
    for (const [a, b] of pairs) {
      const files = [inboxName(2, b!), inboxName(1, a!)];
      const m = matchInbox("2026-01-09", files);
      expect(m).toMatchObject({ ok: true, hour1: inboxName(1, a!), hour2: inboxName(2, b!) });
    }
    expect(inboxName(1, "../../etc/passwd.wav")).toBe("1-.._.._etc_passwd.wav");
  });

  test("the next pass fetches the next show; a 4th show waits while 3 shows' audio is on disk (inbox folders + prepared MP3s)", async () => {
    const w = await make();
    const deps = fetchDeps(w);
    await fetchPass(deps); // 01-02
    await fetchPass(deps); // 01-30 (01-09, 01-16, 01-23 have questions)
    expect((await readdir(w.inboxDir)).sort()).toEqual(["2026-01-02", "2026-01-30"]);
    await mkdir(w.preparedDir, { recursive: true });
    await writeFile(join(w.preparedDir, "pkg-12-19-25.mp3"), "mp3"); // a third show, already joined
    w.cv.rows.set("2026-02-06", { ...structuredClone(w.cv.rows.get("2026-01-30")!), showDate: "2026-02-06" });
    const before = downloads(w).length;
    await fetchPass(deps);
    expect(downloads(w)).toHaveLength(before);
    expect(await readdir(w.inboxDir)).not.toContain("2026-02-06");
  });

  test("an audio question (RECAP folder, unclear audio) is never downloaded, even once answered (R5)", async () => {
    const w = await make();
    const deps = fetchDeps(w);
    w.cv.extra.set("2026-01-16", { questions: [{ id: "q", text: "?", kind: "audio", answer: "use them" }] });
    for (const d of ["2026-01-02", "2026-01-30"]) w.cv.packages.set(d, "succeeded"); // nothing else is waiting
    for (let i = 0; i < 3; i++) await fetchPass(deps);
    expect(downloads(w)).toEqual([]);
    expect(await readdir(w.inboxDir).catch(() => [])).toEqual([]);
  });

  test("a failed download leaves no .part, is recorded, waits out the backoff, then is retried", async () => {
    let fail = true;
    let now = 0;
    const w = await make({
      download: { "GET /d": (req, res) => {
        const size = Number(req.query.get("size"));
        res.writeHead(200, { "content-length": String(size) });
        if (fail) return void res.destroy(); // the connection drops mid-file
        res.end(Buffer.alloc(size, 1));
      } },
    });
    const deps = fetchDeps(w, () => now);
    await fetchPass(deps);
    expect(w.cv.fetches.at(-1)).toEqual({ showDate: "2026-01-02", status: "failed", error: "download_failed" });
    const left = await readdir(join(w.inboxDir, "2026-01-02")).catch(() => []);
    expect(left.filter((f) => f.includes("part"))).toEqual([]);
    expect(w.logs.some((l) => l.startsWith("ingest date=2026-01-02 step=fetch ok=false"))).toBe(true);

    fail = false;
    now = RETRY_BACKOFF_MS - 1;
    const n = downloads(w).length;
    await fetchPass(deps); // the failed show waits; the next one may go
    expect(w.cv.fetches.filter((f) => f.showDate === "2026-01-02").at(-1)!.status).toBe("failed");
    now = 2 * RETRY_BACKOFF_MS;
    await fetchPass(deps);
    expect(w.cv.fetches.filter((f) => f.showDate === "2026-01-02").at(-1)!.status).toBe("fetched");
    expect(downloads(w).length).toBeGreaterThan(n);
  });

  test("ingest's own stale .ingest-part is removed at the start of a pass; Tarik's hand copy (.wav.part) is never touched", async () => {
    const w = await make();
    const dir = join(w.inboxDir, "2026-01-02");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "2-9126.wav.ingest-part"), "half");
    await writeFile(join(dir, "1-9125.wav"), Buffer.alloc(600, 1)); // hour 1 finished before the crash
    const hand = join(w.inboxDir, "2026-02-13");
    await mkdir(hand);
    await writeFile(join(hand, "9125.wav.part"), "copying"); // DEPLOY's `cat > x.wav.part && mv` hand copy, mid-copy
    await fetchPass(fetchDeps(w));
    expect((await readdir(dir)).sort()).toEqual(["1-9125.wav", "2-9126.wav"]);
    expect(await readdir(hand)).toEqual(["9125.wav.part"]);
    expect(downloads(w)).toEqual(["1002"]);
  });

  test.each(["hour1", "hour2"] as const)("a listed %s over 2 GB is refused before anything is downloaded or a folder made", async (h) => {
    const w = await make();
    const row = w.cv.rows.get("2026-01-02")!;
    row.audio[h]!.size = 2 * 1024 ** 3 + 1;
    await fetchPass(fetchDeps(w));
    expect(downloads(w)).toEqual([]);
    expect(w.cv.fetches.at(-1)).toEqual({ showDate: "2026-01-02", status: "failed", error: "too_large" });
    expect(await readdir(w.inboxDir).catch(() => [])).toEqual([]);
  });

  test("a failed download with no finished hour removes its date folder, so it holds no disk slot", async () => {
    const w = await make();
    w.cv.rows.get("2026-01-02")!.audio.hour1!.size = 601 * MB; // Box sends 600: size_mismatch
    await fetchPass(fetchDeps(w));
    expect(w.cv.fetches.at(-1)).toEqual({ showDate: "2026-01-02", status: "failed", error: "size_mismatch" });
    expect(await readdir(w.inboxDir)).toEqual([]);
  });

  test("after 3 failures a show is not tried again (Episodes keeps 'failed'), and its slot goes to the next show", async () => {
    let now = 0;
    const w = await make();
    w.cv.rows.get("2026-01-02")!.audio.hour2!.size = 601 * MB; // hour 1 downloads fine; hour 2 never matches
    const deps = fetchDeps(w, () => now);
    for (let i = 0; i < MAX_FETCH_FAILURES; i++) {
      await fetchPass(deps);
      if (i === 0) expect(await readdir(join(w.inboxDir, "2026-01-02"))).toEqual(["1-9125.wav"]); // a finished hour is kept to resume
      now += RETRY_BACKOFF_MS + 1;
    }
    expect(w.cv.fetches.filter((f) => f.showDate === "2026-01-02" && f.status === "failed")).toHaveLength(3);
    expect(await readdir(w.inboxDir)).toEqual([]); // given up: its files are gone, the slot is free
    await fetchPass(deps);
    expect(downloads(w).filter((id) => id === "1002")).toHaveLength(3); // no 4th attempt
    expect(w.cv.fetches.at(-1)).toEqual({ showDate: "2026-01-30", status: "fetched" });
    expect(w.cv.fetches.filter((f) => f.showDate === "2026-01-02").at(-1)!.status).toBe("failed");
  });
});

describe("draft: one show at a time (Review Focus 4)", () => {
  test("two scans and two passes in a row queue exactly one draft run", async () => {
    const w = await make();
    const deps = { convex: w.cv.convex, log: w.deps.log, last: { key: "" }, scan: w.deps.memory };
    await draftPass(deps);
    await runScan(w.deps);
    await draftPass(deps);
    expect(w.cv.runs).toEqual([{ showDate: "2026-01-02", open: true }]);
    expect(w.cv.draftCalls.map((c) => c.outcome)).toEqual([{ queued: true, runId: "run-1" }, { queued: false, reason: "drafting" }]);
    expect(w.logs.filter((l) => l.includes("step=draft"))).toEqual([
      expect.stringMatching(/^ingest date=2026-01-02 step=draft ok=true queued=true ms=\d+$/),
      expect.stringMatching(/^ingest date=2026-01-02 step=draft ok=true queued=false reason=drafting ms=\d+$/),
    ]);
    await draftPass(deps); // same outcome again: not logged again
    expect(w.logs.filter((l) => l.includes("step=draft"))).toHaveLength(2);
  });

  test("no request while 3 packages await review; a draft-failed show (R10) is passed over for the next", async () => {
    const w = await make();
    const deps = { convex: w.cv.convex, log: w.deps.log, last: { key: "" }, scan: w.deps.memory };
    w.cv.setAwaiting(3);
    await draftPass(deps);
    expect(w.cv.draftCalls).toEqual([]);
    w.cv.setAwaiting(0);
    w.cv.runs.push({ showDate: "2026-01-02", open: false }, { showDate: "2026-01-02", open: false });
    await draftPass(deps);
    expect(w.cv.draftCalls.map((c) => c.showDate)).toEqual(["2026-01-30"]);
  });

  test("the notes go only into the upsert (draft input), never into a log, a fetch record or a draft request", async () => {
    const w = await make();
    await fetchPass(fetchDeps(w));
    await draftPass({ convex: w.cv.convex, log: w.deps.log, last: { key: "" }, scan: w.deps.memory });
    const outside = JSON.stringify([w.logs, w.cv.fetches, w.cv.draftCalls, w.cv.sources, await w.cv.convex.list()]);
    expect(outside).not.toContain(NOTES_SECRET);
    // Hard Rule 8: every line is key=value with plain values: no names, titles, URLs or JSON can ride along.
    for (const line of w.logs) expect(line).toMatch(/^ingest( date=\d{4}-\d{2}-\d{2})?( [a-z_]+=[\w.-]+)+$/);
    expect(w.logs.some((l) => l.includes("step=fetch")) && w.logs.some((l) => l.includes("step=draft"))).toBe(true);
    expect(JSON.stringify(w.cv.upserts)).toContain(NOTES_SECRET);
  });
});

