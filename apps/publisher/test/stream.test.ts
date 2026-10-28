import { afterEach, expect, test, vi } from "vitest";

// The MP3 (~140 MB in production) must be streamed from disk, never read into memory whole.
// Proof by spies: every way to read a file whole (readFile, readFileSync, fs.promises.readFile) is wrapped and
// must never see the MP3 path, while openAsBlob (Node's lazily read, file-backed Blob, which fetch's FormData
// encoder pulls chunk by chunk as the socket drains) must. The fake server must still receive every byte.
const spy = vi.hoisted(() => ({ whole: [] as string[], blob: [] as string[] }));
vi.mock("node:fs", async (orig) => {
  const m = await orig<typeof import("node:fs")>();
  const promises = { ...m.promises, readFile: (p: never, ...a: never[]) => (spy.whole.push(String(p)), m.promises.readFile(p, ...a)) };
  return {
    ...m, promises,
    readFileSync: (p: never, ...a: never[]) => (spy.whole.push(String(p)), m.readFileSync(p, ...a)),
    openAsBlob: (p: never, o: never) => (spy.blob.push(String(p)), m.openAsBlob(p, o)),
  };
});
vi.mock("node:fs/promises", async (orig) => {
  const m = await orig<typeof import("node:fs/promises")>();
  return { ...m, readFile: (p: never, ...a: never[]) => (spy.whole.push(String(p)), m.readFile(p, ...a)) };
});

const { randomBytes } = await import("node:crypto");
const { join } = await import("node:path");
const { publishPass, statusReporter } = await import("../src/publish.js");
const { openState } = await import("../src/state.js");
const { fakeConvex, fakeServer, queueItem, sha256, workspace } = await import("./helpers.js");

let server: Awaited<ReturnType<typeof fakeServer>> | undefined;
afterEach(async () => void (await server?.close()));

test("the MP3 goes up from a file-backed Blob; no whole-file read of it ever happens", async () => {
  server = await fakeServer();
  const ws = await workspace(randomBytes(8 * 1024 * 1024));
  const item = queueItem(ws.mp3);
  await ws.addMp3(item.packageId);
  const fake = fakeConvex([item], { coverBase: server.base });
  await publishPass({
    convex: fake.convex, log: () => {}, tokenFile: ws.tokenFile, preparedDir: ws.preparedDir,
    state: await openState(ws.stateFile), report: statusReporter(fake.convex), alert: async () => true, uploadUrl: server.uploadUrl,
  });
  const mp3Path = join(ws.preparedDir, `${item.packageId}.mp3`);
  expect(spy.blob).toEqual([mp3Path]);
  expect(spy.whole).not.toContain(mp3Path);
  expect(spy.whole).toContain(ws.tokenFile); // the spies are live: small files are read whole
  const mp3 = server.uploads()[0]!.form!.get("mp3") as File;
  expect(mp3.size).toBe(ws.mp3.length);
  expect(sha256(Buffer.from(await mp3.arrayBuffer()))).toBe(sha256(ws.mp3));
  expect(fake.calls.filter((c) => c[0] === "result")).toEqual([["result", item.packageId, expect.objectContaining({ status: "succeeded" })]]);
});
