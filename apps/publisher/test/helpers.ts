import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageDraft } from "@aircheck/core";
import { goldenDraft } from "../../../packages/core/test/helpers/goldens";
import type { MixcloudStatus, PublisherConvex, PublishResult, QueueItem, ReviewItem, UpdateClaim, UpdateOutcome } from "../src/convex.js";

export const ACCESS_TOKEN = "mc-access-token-SECRET-1234567890";
export const BOT_TOKEN = "123456:telegram-bot-SECRET";
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
export const SUCCESS = { result: { success: true, message: "Uploaded", key: "/rhythmlab/rhythm-lab-radio-10-2-26/" } };

export const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

/** One recorded request to the fake Mixcloud / Telegram / cover server. `form` is the parsed multipart body. */
export interface Seen { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"]; body: Buffer; form?: FormData }

export const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
  });

type Handler = (req: IncomingMessage, res: ServerResponse, seen: Seen[]) => void | Promise<void>;
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
export const reply = json;

/**
 * A fake for every outside service on 127.0.0.1: the Mixcloud upload (`/upload/`), covers (`/cover/<id>`) and
 * Telegram (`/bot<token>/sendMessage`). `upload` handlers run in order, one per upload request; the last repeats.
 */
export async function fakeServer(opts: { upload?: Handler[]; cover?: Buffer; edit?: Handler[] } = {}) {
  const seen: Seen[] = [];
  const uploads = opts.upload ?? [];
  const edits = opts.edit ?? [];
  let n = 0;
  let e = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const base = { method: req.method ?? "", path: url.pathname, query: url.searchParams, headers: req.headers };
    if (url.pathname === "/upload/") {
      const handler = uploads[Math.min(n++, uploads.length - 1)] ?? okUpload;
      return handler(req, res, seen);
    }
    // A description edit (Plan 5c Task 4): /upload/<user>/<slug>/edit/
    if (/^\/upload\/.+\/edit\/$/.test(url.pathname)) return (edits[Math.min(e++, edits.length - 1)] ?? okEdit)(req, res, seen);
    const body = await readBody(req);
    seen.push({ ...base, body });
    if (url.pathname.startsWith("/cover/")) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(opts.cover ?? JPEG);
    }
    if (url.pathname.startsWith("/down/")) return json(res, 503, {}); // a storage outage
    if (url.pathname.endsWith("/sendMessage")) return json(res, 200, { ok: true });
    json(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base, seen,
    uploadUrl: `${base}/upload/`,
    /** Uploads whose body was read and parsed. */
    uploads: () => seen.filter((s) => s.path === "/upload/"),
    /** Every request that reached /upload/, whatever its handler did with it. */
    uploadRequests: () => n,
    /** Description edits whose body was read and parsed, and every request that reached an edit path. */
    edits: () => seen.filter((s) => s.path.endsWith("/edit/")),
    editRequests: () => e,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Reads the whole multipart body (fine in a test: the fake MP3 is small) and answers. */
export const recordUpload = (status: number, body: unknown, headers: Record<string, string> = {}): Handler =>
  async (req, res, seen) => {
    const url = new URL(req.url ?? "/", "http://x");
    const raw = await readBody(req);
    const form = await new Response(raw, { headers: { "content-type": String(req.headers["content-type"]) } }).formData();
    seen.push({ method: req.method ?? "", path: url.pathname, query: url.searchParams, headers: req.headers, body: raw, form });
    json(res, status, body, headers);
  };
export const okUpload = recordUpload(200, SUCCESS);
export const okEdit = recordUpload(200, { result: { success: true, message: "Cloudcast updated" } });

/** A fake Convex that keeps package statuses like the gate does, and records every call. */
export function fakeConvex(items: QueueItem[], opts: { publishedToday?: number; coverBase?: string; review?: ReviewItem[]; updates?: UpdateClaim[] } = {}) {
  const status = new Map<string, string>(items.map((p) => [p.packageId, "approved"]));
  const updates = opts.updates ?? [];
  const updateStatus = new Map<string, string>(updates.map((u) => [u.id, "approved"]));
  const calls: Array<[string, ...unknown[]]> = [];
  const move = (id: string, from: string, to: string) => {
    if (status.get(id) !== from) throw new Error(`NOT_READY ${id}`);
    status.set(id, to);
  };
  const convex: PublisherConvex = {
    async queue() {
      calls.push(["queue"]);
      return { packages: items.filter((p) => status.get(p.packageId) === "approved"), publishedToday: opts.publishedToday ?? 0 };
    },
    async claim(id) { calls.push(["claim", id]); move(id, "approved", "publishing"); },
    async result(id, r: PublishResult) { calls.push(["result", id, r]); move(id, "publishing", r.status); },
    async unclaim(id) { calls.push(["unclaim", id]); move(id, "publishing", "approved"); },
    async reconcile() {
      calls.push(["reconcile"]);
      const stuck = [...status].filter(([, s]) => s === "publishing").map(([id]) => id);
      for (const id of stuck) status.set(id, "outcome_unknown");
      return stuck;
    },
    async coverUrl(storageId) { calls.push(["coverUrl", storageId]); return `${opts.coverBase}/cover/${storageId}`; },
    async setMixcloud(s: MixcloudStatus) { calls.push(["setMixcloud", s]); },
    async awaitingReview() { calls.push(["awaitingReview"]); return opts.review ?? []; },
    async claimUpdate() {
      calls.push(["claimUpdate"]);
      const u = updates.find((x) => updateStatus.get(x.id) === "approved");
      if (u) updateStatus.set(u.id, "pushing");
      return u ?? null;
    },
    async recordUpdate(id, outcome: UpdateOutcome) {
      calls.push(["recordUpdate", id, outcome]);
      if (updateStatus.get(id) !== "pushing") throw new Error(`NOT_READY ${id}`);
      updateStatus.set(id, outcome.status === "unclaim" || outcome.status === "retry" ? "approved" : outcome.status);
    },
  };
  return { convex, calls, status, updateStatus, names: () => calls.map((c) => c[0]) };
}

/** A temp dir holding the prepared MP3, the token file and the state file. */
export async function workspace(mp3 = randomBytes(256 * 1024)) {
  const dir = await mkdtemp(join(tmpdir(), "publisher-"));
  const preparedDir = join(dir, "prepared");
  await mkdir(preparedDir);
  const tokenFile = join(dir, "token.json");
  const writeToken = (access_token = ACCESS_TOKEN) =>
    writeFile(tokenFile, JSON.stringify({ access_token, account: "rhythmlab", connectedAt: 1_761_000_000_000 }));
  await writeToken();
  const addMp3 = (id: string, bytes: Buffer = mp3) => writeFile(join(preparedDir, `${id}.mp3`), bytes);
  return { dir, preparedDir, tokenFile, writeToken, addMp3, mp3, stateFile: join(dir, "state.json"), secretsFile: join(dir, "secrets.env") };
}

export function queueItem(mp3: Buffer, overrides: Partial<PackageDraft> = {}, extra: Partial<QueueItem> = {}): QueueItem {
  const draft = goldenDraft({ audio: { hour1Id: "1.wav", hour2Id: "2.wav", mp3Sha256: sha256(mp3), mp3Bytes: mp3.length }, ...overrides });
  return { packageId: draft.id, showDate: draft.showDate, decidedAt: "2026-10-03T12:00:00.000Z", draft, fingerprint: "fp", coverStorageId: "cover-1", ...extra };
}
