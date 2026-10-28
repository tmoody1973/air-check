import { chmod, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Attached, MediaConvex, PendingPackage, WaitingItem } from "../src/convex.js";
import type { Exec } from "../src/encode.js";
import { QUIET_MS, RETRY_BACKOFF_MS, runPass, type PassDeps } from "../src/inbox.js";

let root: string, inboxDir: string, preparedDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "media-"));
  inboxDir = join(root, "inbox");
  preparedDir = join(root, "prepared");
  await mkdir(inboxDir);
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** A complete WAV: RIFF header whose size field + 8 is the file's length, then `body` bytes of audio. */
const wav = (body = 32) => {
  const b = Buffer.alloc(44 + body);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8, "ascii");
  return b;
};
/** Written 10 minutes ago, so the copy is long finished. */
const settledAt = () => new Date(Date.now() - 10 * 60_000);
const addShow = async (date: string, files = ["1-hour.wav", "2-hour.wav"], content: (f: string) => Buffer | string = () => wav()) => {
  await mkdir(join(inboxDir, date), { recursive: true });
  for (const f of files) {
    await writeFile(join(inboxDir, date, f), content(f));
    await utimes(join(inboxDir, date, f), settledAt(), settledAt());
  }
};

interface Fake extends MediaConvex { attachedCalls: Attached[]; waitingCalls: WaitingItem[][] }
function fakeConvex(pending: PendingPackage[], cleanup: string[] = [], status: Record<string, string> = {}): Fake {
  const f: Fake = {
    attachedCalls: [], waitingCalls: [],
    pending: async () => pending, cleanup: async () => cleanup,
    statuses: async (ids) => ids.flatMap((packageId) => (status[packageId] ? [{ packageId, status: status[packageId]! }] : [])),
    attached: async (a) => void f.attachedCalls.push(a),
    waiting: async (items) => void f.waitingCalls.push(items),
  };
  return f;
}

const calls: { file: string; args: string[] }[] = [];
const okExec = (failEncode = false): Exec => async (file, args) => {
  calls.push({ file, args });
  if (file === "ffprobe") return { stdout: args.at(-1)!.includes("1-hour") ? "3601.4\n" : "3599.9\n" };
  const out = args.at(-1)!;
  await writeFile(out, "fake mp3");
  if (failEncode) throw new Error("ffmpeg died");
  return { stdout: "" };
};
beforeEach(() => void (calls.length = 0));

const pass = (convex: MediaConvex, exec: Exec, log: (l: string) => void = () => {}, extra: Partial<PassDeps> = {}) =>
  runPass({ convex, exec, log, inboxDir, preparedDir, maxPrepared: 3, ...extra });

describe("runPass", () => {
  test("encodes a matched folder in hour order and attaches it", async () => {
    await addShow("2026-10-02", ["2-hour.wav", "1-hour.wav"]);
    const convex = fakeConvex([{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }]);
    await pass(convex, okExec());
    const ffmpeg = calls.find((c) => c.file === "ffmpeg")!;
    const inputs = ffmpeg.args.flatMap((a, i) => (ffmpeg.args[i - 1] === "-i" ? [a] : []));
    expect(inputs.map((p) => p.split("/").at(-1))).toEqual(["1-hour.wav", "2-hour.wav"]);
    expect(ffmpeg.args).toContain("192k");
    expect(convex.attachedCalls).toEqual([{
      packageId: "pkg-10-2-26", hour1Id: "1-hour.wav", hour2Id: "2-hour.wav",
      mp3Sha256: createHash("sha256").update("fake mp3").digest("hex"), hour1DurationSec: 3601, mp3Bytes: 8,
    }]);
    expect((await stat(join(preparedDir, "pkg-10-2-26.mp3"))).mode & 0o777).toBe(0o644);
    expect(await readdir(preparedDir)).toEqual(["pkg-10-2-26.mp3"]);
    expect(convex.waitingCalls).toEqual([[]]);
  });

  test("a 4th package waits while 3 MP3s are prepared, and the reason names what holds them", async () => {
    await mkdir(preparedDir);
    for (const n of ["pkg-10-2-26", "pkg-9-25-26", "pkg-9-18-26"]) await writeFile(join(preparedDir, `${n}.mp3`), "x");
    await addShow("2026-10-09");
    const convex = fakeConvex([{ packageId: "pkg-10-9-26", showDate: "2026-10-09" }], [], {
      "pkg-10-2-26": "failed", "pkg-9-25-26": "awaiting_review", // pkg-9-18-26 has no package any more
    });
    await pass(convex, okExec());
    expect(calls).toHaveLength(0);
    expect(convex.waitingCalls[0]).toEqual([{
      showDate: "2026-10-09",
      reason: "2026-10-09 waits: 3 prepared MP3s are held by pkg-10-2-26 (failed), pkg-9-18-26 (no package), pkg-9-25-26 (awaiting review)",
    }]);
  });

  test("if the statuses can't be read, the slots are still named", async () => {
    await mkdir(preparedDir);
    for (const n of ["pkg-a", "pkg-b", "pkg-c"]) await writeFile(join(preparedDir, `${n}.mp3`), "x");
    await addShow("2026-10-09");
    const convex = fakeConvex([{ packageId: "pkg-10-9-26", showDate: "2026-10-09" }]);
    convex.statuses = async () => { throw new Error("convex down"); };
    await pass(convex, okExec());
    expect(convex.waitingCalls[0]![0]!.reason).toBe("2026-10-09 waits: 3 prepared MP3s are held by pkg-a, pkg-b, pkg-c");
  });

  test("its own existing MP3 does not count, and is re-encoded over", async () => {
    await mkdir(preparedDir);
    for (const n of ["pkg-10-9-26", "b", "c"]) await writeFile(join(preparedDir, `${n}.mp3`), "old");
    await addShow("2026-10-09");
    const convex = fakeConvex([{ packageId: "pkg-10-9-26", showDate: "2026-10-09" }]);
    await pass(convex, okExec());
    expect(convex.attachedCalls).toHaveLength(1);
    expect(convex.attachedCalls[0]!.mp3Bytes).toBe(8);
  });

  test("a failed encode leaves no partial file and is reported", async () => {
    await addShow("2026-10-02");
    const convex = fakeConvex([{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }]);
    await pass(convex, okExec(true));
    expect(await readdir(preparedDir)).toEqual([]);
    expect(convex.attachedCalls).toHaveLength(0);
    expect(convex.waitingCalls[0]).toEqual([{ showDate: "2026-10-02", reason: "Encoding failed for 2026-10-02; will retry" }]);
  });

  test("a non-numeric ffprobe answer is an encode failure", async () => {
    await addShow("2026-10-02");
    const convex = fakeConvex([{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }]);
    await pass(convex, async () => ({ stdout: "N/A\n" }));
    expect(convex.waitingCalls[0]![0]!.reason).toBe("Encoding failed for 2026-10-02; will retry");
  });

  test("a folder without a package is reported, not encoded", async () => {
    await addShow("2026-10-09");
    const convex = fakeConvex([]);
    await pass(convex, okExec());
    expect(calls).toHaveLength(0);
    expect(convex.waitingCalls[0]).toEqual([{ showDate: "2026-10-09", reason: "2026-10-09 has audio but no draft package for that date yet" }]);
  });

  test("an already prepared show with no pending package is not reported as stuck", async () => {
    await addShow("2026-10-02");
    await mkdir(preparedDir);
    await writeFile(join(preparedDir, "pkg-10-2-26.mp3"), "x");
    const convex = fakeConvex([]);
    await pass(convex, okExec());
    expect(convex.waitingCalls).toEqual([[]]);
  });

  test("a folder that does not match is reported with matchInbox's reason", async () => {
    await addShow("2026-10-02", ["only.wav"]);
    const convex = fakeConvex([{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }]);
    await pass(convex, okExec());
    expect(calls).toHaveLength(0);
    expect(convex.waitingCalls[0]![0]!.reason).toContain("needs exactly two .wav files");
  });

  test("cleanup deletes the MP3 and the inbox folder, ignores missing ones and bad ids", async () => {
    await addShow("2026-10-02");
    await mkdir(preparedDir);
    await writeFile(join(preparedDir, "pkg-10-2-26.mp3"), "x");
    const convex = fakeConvex([], ["pkg-10-2-26", "pkg-1-5-27", "../../etc", "pkg-10-2-26"]);
    const lines: string[] = [];
    await pass(convex, okExec(), (l) => lines.push(l));
    expect(await readdir(preparedDir)).toEqual([]);
    expect(await readdir(inboxDir)).toEqual([]);
    // M1: logged once, for the removal that happened; ids with nothing on disk (every later pass) log nothing.
    expect(lines.filter((l) => l.includes("step=cleanup"))).toHaveLength(1);
    lines.length = 0;
    await pass(convex, okExec(), (l) => lines.push(l));
    expect(lines.filter((l) => l.includes("step=cleanup"))).toEqual([]);
  });

  test("logs carry no token, paths or titles", async () => {
    await addShow("2026-10-02", ["1-SECRET TITLE.wav", "2-SECRET TITLE.wav"]);
    const lines: string[] = [];
    await pass(fakeConvex([{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }]), okExec(), (l) => lines.push(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^media date=\S+ package=\S+ step=\w+ ok=(true|false) ms=\d+$/);
    expect(lines.join("\n")).not.toMatch(/SECRET|\/|token/i);
  });

  describe("retry backoff", () => {
    const pkg = [{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }];
    const reason = [{ showDate: "2026-10-02", reason: "Encoding failed for 2026-10-02; will retry" }];

    test("a failed attach is not re-encoded next pass, keeps its reason, and retries after the backoff", async () => {
      await addShow("2026-10-02");
      let t = Date.now(), failAttach = true;
      const convex = fakeConvex(pkg);
      convex.attached = async (a) => { if (failAttach) throw new Error("convex down"); convex.attachedCalls.push(a); };
      const extra = { failedAt: new Map<string, number>(), now: () => t };
      await pass(convex, okExec(), undefined, extra);
      const encodes = () => calls.filter((c) => c.file === "ffmpeg").length;
      expect(encodes()).toBe(1);
      t += 30_000;
      await pass(convex, okExec(), undefined, extra);
      expect(encodes()).toBe(1);
      expect(convex.waitingCalls.at(-1)).toEqual(reason);
      failAttach = false;
      t += RETRY_BACKOFF_MS;
      await pass(convex, okExec(), undefined, extra);
      expect(encodes()).toBe(2);
      expect(convex.attachedCalls).toHaveLength(1);
      expect(convex.waitingCalls.at(-1)).toEqual([]);
    });

    test("a failed encode backs off too", async () => {
      await addShow("2026-10-02");
      let t = Date.now();
      const extra = { failedAt: new Map<string, number>(), now: () => t };
      const convex = fakeConvex(pkg);
      await pass(convex, okExec(true), undefined, extra);
      t += 60_000;
      await pass(convex, okExec(true), undefined, extra);
      expect(calls.filter((c) => c.file === "ffmpeg")).toHaveLength(1);
      expect(convex.waitingCalls.at(-1)).toEqual(reason);
    });
  });

  test("an unreadable folder is reported and the next folder still encodes", async () => {
    await addShow("2026-10-01");
    await addShow("2026-10-02");
    await chmod(join(inboxDir, "2026-10-01"), 0o000);
    try {
      const convex = fakeConvex([{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }]);
      await pass(convex, okExec());
      expect(convex.attachedCalls).toHaveLength(1);
      expect(convex.waitingCalls).toEqual([[{ showDate: "2026-10-01", reason: "2026-10-01 folder could not be read" }]]);
    } finally { await chmod(join(inboxDir, "2026-10-01"), 0o755); }
  });

  test("a timed-out ffmpeg is an ordinary encode failure with backoff", async () => {
    await addShow("2026-10-02");
    const timedOut: Exec = async () => { throw Object.assign(new Error("Command failed"), { killed: true, signal: "SIGKILL" }); };
    const extra = { failedAt: new Map<string, number>(), now: () => Date.now() };
    const convex = fakeConvex([{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }]);
    await pass(convex, timedOut, undefined, extra);
    expect(convex.waitingCalls[0]).toEqual([{ showDate: "2026-10-02", reason: "Encoding failed for 2026-10-02; will retry" }]);
    expect(extra.failedAt.has("pkg-10-2-26")).toBe(true);
  });

  // C1: a WAV still being copied (or a copy that died) must never be encoded into a short public show.
  describe("a WAV that is not completely copied", () => {
    const pkg = [{ packageId: "pkg-10-2-26", showDate: "2026-10-02" }];
    const copying = [{ showDate: "2026-10-02", reason: "2026-10-02 is still copying (or the copy is incomplete)" }];

    test("a WAV cut off after its header is never encoded", async () => {
      await addShow("2026-10-02", undefined, (f) => (f.startsWith("2") ? wav(4096).subarray(0, 44) : wav()));
      const convex = fakeConvex(pkg);
      await pass(convex, okExec());
      expect(calls).toHaveLength(0);
      expect(convex.attachedCalls).toEqual([]);
      expect(convex.waitingCalls[0]).toEqual(copying);
    });

    test.each([
      ["not RIFF", () => Buffer.concat([Buffer.from("JUNK"), wav().subarray(4)])],
      ["not WAVE", () => { const b = wav(); b.write("AVI ", 8, "ascii"); return b; }],
      ["shorter than a header", () => Buffer.from("RIFF")],
      ["empty", () => Buffer.alloc(0)],
    ])("%s: waits, never encoded", async (_n, bad) => {
      await addShow("2026-10-02", undefined, (f) => (f.startsWith("1") ? bad() : wav()));
      const convex = fakeConvex(pkg);
      await pass(convex, okExec());
      expect(calls).toHaveLength(0);
      expect(convex.waitingCalls[0]).toEqual(copying);
    });

    test("a complete WAV written in the last 2 minutes waits; once quiet, the pair encodes", async () => {
      await addShow("2026-10-02");
      const fresh = new Date();
      await utimes(join(inboxDir, "2026-10-02", "1-hour.wav"), fresh, fresh);
      let t = fresh.getTime() + QUIET_MS - 1_000;
      const convex = fakeConvex(pkg);
      await pass(convex, okExec(), undefined, { now: () => t });
      expect(calls).toHaveLength(0);
      expect(convex.waitingCalls[0]).toEqual(copying);
      t = fresh.getTime() + QUIET_MS + 1_000;
      await pass(convex, okExec(), undefined, { now: () => t });
      expect(convex.attachedCalls).toHaveLength(1);
      expect(convex.waitingCalls.at(-1)).toEqual([]);
    });
  });
});
