import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { encodeMp3, probeSeconds, realExec } from "../src/encode.js";

const have = (bin: string) => { try { execFileSync(bin, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } };

// Opt-in by environment: skipped cleanly where ffmpeg/ffprobe are not installed.
describe.skipIf(!(have("ffmpeg") && have("ffprobe")))("real ffmpeg/ffprobe", () => {
  test("joins two WAVs into one ~5 s MP3 and measures hour 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "media-ff-"));
    try {
      const [w1, w2, out] = [join(dir, "1.wav"), join(dir, "2.wav"), join(dir, "o.mp3")];
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", w1]);
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=2", w2]);
      expect(await probeSeconds(realExec, w1)).toBe(3);
      await encodeMp3(realExec, w1, w2, out);
      const head = await readFile(out);
      expect(head.subarray(0, 3).toString() === "ID3" || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)).toBe(true);
      const { stdout } = await realExec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out]);
      expect(Math.abs(Number.parseFloat(stdout) - 5)).toBeLessThanOrEqual(0.5);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
