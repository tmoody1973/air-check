import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { parseRange } from "@/lib/byteRange";
import { realHumanSession } from "@/lib/session";

// The package page's player: the prepared MP3 from the read-only /audio mount, to signed-in staff only.
// Demo never comes here; it plays the bundled sample.
const PACKAGE_ID = /^pkg-\d{1,2}-\d{1,2}-\d{2}$/;
const BASE = { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "Accept-Ranges": "bytes" };
const plain = (status: number, text: string) =>
  new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  if (!(await realHumanSession())) return plain(403, "Forbidden");
  const { packageId } = await params;
  // The id is the whole file name, so checking it here is what keeps the path inside AUDIO_DIR.
  if (!PACKAGE_ID.test(packageId)) return plain(400, "Bad package id.");
  const path = join(process.env.AUDIO_DIR || "/audio", `${packageId}.mp3`);

  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return plain(404, "No prepared audio for this show.");
  const size = info.size;
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...BASE, "Content-Range": `bytes */${size}` } });

  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>);
  const headers = { ...BASE, "Content-Length": String(size === 0 ? 0 : end - start + 1) };
  return range
    ? new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` } })
    : new Response(body, { status: 200, headers });
}
