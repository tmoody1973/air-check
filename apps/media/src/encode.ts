import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

/** Runs a program with an args array, no shell. Injected so tests never need ffmpeg. */
export type Exec = (file: string, args: string[]) => Promise<{ stdout: string }>;

export const realExec: Exec = (file, args) =>
  new Promise((resolve, reject) => execFile(file, args, { maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve({ stdout }))));

/** Real length of one WAV, in whole seconds. A non-numeric answer is a failure. */
export async function probeSeconds(exec: Exec, wav: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", wav]);
  const sec = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("ffprobe gave no duration");
  return Math.round(sec);
}

/** Joins the two WAVs (in the order given) into one 192 kbps CBR MP3 at `out`. */
export async function encodeMp3(exec: Exec, wav1: string, wav2: string, out: string): Promise<void> {
  await exec("ffmpeg", [
    "-nostdin", "-y", "-v", "error", "-i", wav1, "-i", wav2,
    "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[a]", "-map", "[a]",
    "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", out,
  ]);
}

/** sha256 by streaming, so a 200 MB file is never held in memory. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}
