import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxClient } from "../src/box.js";
import { driveClient } from "../src/drive.js";
import { dropboxClient } from "../src/dropbox.js";
import { newMemory, type ScanDeps } from "../src/scan.js";
import { fakeConvex } from "./convexFake.js";
import { fakeServer, json, testHttp, type Handler } from "./fakes.js";

// One fake world: Box (root folder 123), Google, Dropbox and Box's download host, each on its own 127.0.0.1 server,
// a temp token dir, inbox and prepared folder, and the fake Convex.

export const MB = 1_000_000;
const wav = (id: string, name: string, size = 600 * MB) => ({ type: "file", id, name, size });
export const NOTES_SECRET = "PRIVATE-NOTE: Alfa Mist told me about the new record in confidence.";

/** Box: dated show folders and their files (2026 and one 2025 that must be ignored). */
export const BOX_FOLDERS: Record<string, { id: string; files: ReturnType<typeof wav>[] }> = {
  "1-2-26": { id: "201", files: [wav("1001", "9125.wav"), wav("1002", "9126.wav"), { type: "file", id: "1003", name: "9101.wav", size: 5 }] },
  "1-9-26": { id: "202", files: [wav("1011", "29934_Rhythm Lab Radio hour 1_Tarik Moody_010926.wav"), wav("1012", "29935_Rhythm Lab Radio hour 2_Tarik Moody_010926.wav")] },
  "RECAP 1-16-26": { id: "203", files: [wav("1021", "9125.wav"), wav("1022", "9126.wav")] },
  "1-23-26": { id: "204", files: [wav("1031", "RLR - Full Hour 1 - 012326.wav"), wav("1032", "RLR- Full Hour 2 - 012326.wav")] },
  "1-30-26": { id: "205", files: [wav("1041", "9125.wav"), wav("1042", "9126.wav")] },
  "12-26-25": { id: "199", files: [wav("991", "9125.wav"), wav("992", "9126.wav")] },
};

const h1 = ["Alfa Mist - \"Organic Rust\"", "Nala Sinephro - \"Space 1\""];
const h2 = ["Kokoroko - \"Abusey Junction\"", "Yussef Dayes - \"Black Classical Music\""];
const tracklist = (a: string[], b: string[]) => `Rhythm Lab Radio\nHOUR 1\n${a.join("\n")}\nHOUR 2\n${b.join("\n")}\n`;
export const DRIVE_DOCS: Record<string, { name: string; text: string }> = {
  g1: { name: "Rhythm Lab Radio 1-2-26", text: tracklist(h1, h2) },
  g1prep: { name: "Rhythm Lab Radio 1-2-26 show prep", text: "Ideas: talk to the label. See https://evil.example/x" },
  g2: { name: "Rhythm Lab Radio 1-9-26", text: tracklist(["Moses Sumney - \"Doomed\"", "Sampha - \"Spirit 2.0\""], ["Little Simz - \"Gorilla\"", "Loyle Carner - \"Hate\""]) },
  g4: { name: "Rhythm Lab Radio 1-23-26", text: "HOUR 1\nA - \"One\"\nB - \"Two\"\n" },
  g5: { name: "Rhythm Lab Radio 1-30-26", text: tracklist(["C - \"Three\"", "D - \"Four\""], ["E - \"Five\"", "F - \"Six\""]) },
  gold: { name: "Rhythm Lab Radio 12-26-25", text: tracklist(h1, h2) },
};
/** Paper notes: every track but the closing one of each hour (the skill's rule 3). */
export const PAPER_DOCS: Record<string, { name: string; options: string[]; text: string }> = {
  "id:p1": { name: "Rhythm Lab Radio 1-2-26.paper", options: ["html", "markdown"], text: `${NOTES_SECRET}\n# Hour 1\n## 1. Alfa Mist – "Organic Rust"\n# Hour 2\n## 1. Kokoroko – "Abusey Junction"\n` },
  "id:p2": { name: "Rhythm Lab Radio 1–09-26.paper", options: ["html"], text: "<p>html only</p>" },
  "id:p5": { name: "Rhythm Lab Radio 1-30-26.paper", options: ["markdown"], text: `# Hour 1\n## 1. C – "Three"\n# Hour 2\n## 1. E – "Five"\n` },
  "id:px": { name: "Shopping list 1-2-26.paper", options: ["markdown"], text: "milk" },
};

export interface WorldOptions { googleToken?: unknown; dropboxToken?: unknown; box?: boolean; boxToken?: Handler; googleTokenRoute?: Handler; dropboxTokenRoute?: Handler; download?: Record<string, Handler> }

export async function world(o: WorldOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ingest-"));
  const tokenDir = join(dir, "tokens");
  const inboxDir = join(dir, "inbox");
  const preparedDir = join(dir, "prepared");
  await mkdir(tokenDir);
  const write = async (name: string, v: unknown) => v !== undefined && writeFile(join(tokenDir, name), typeof v === "string" ? v : JSON.stringify(v));
  await write("google.json", "googleToken" in o ? o.googleToken : { refresh_token: "g-refresh", account: "Google account", connectedAt: 1 });
  await write("dropbox.json", "dropboxToken" in o ? o.dropboxToken : { refresh_token: "d-refresh", account: "Dropbox account", connectedAt: 1 });

  const dl = await fakeServer({
    "GET /d": (req, res) => {
      const size = Number(req.query.get("size"));
      res.writeHead(200, { "content-length": String(size) });
      res.end(Buffer.alloc(size, 1));
    },
    ...o.download,
  });
  const byId = new Map(Object.entries(BOX_FOLDERS).flatMap(([, f]) => f.files.map((x) => [x.id, x] as const)));
  const boxRoutes: Record<string, Handler | Handler[]> = {
    "POST /oauth2/token": o.boxToken ?? ((_, res) => json(res, 200, { access_token: "box-access", expires_in: 3600 })),
    "GET /2.0/folders/123/items": (_, res) =>
      json(res, 200, { total_count: Object.keys(BOX_FOLDERS).length + 1, entries: [...Object.entries(BOX_FOLDERS).map(([name, f]) => ({ type: "folder", id: f.id, name })), { type: "file", id: "9", name: "readme.txt", size: 1 }] }),
  };
  for (const f of Object.values(BOX_FOLDERS)) boxRoutes[`GET /2.0/folders/${f.id}/items`] = (_, res) => json(res, 200, { total_count: f.files.length, entries: f.files });
  for (const id of byId.keys())
    // ponytail: the fake serves a small body; the test's Box listing sizes are what the download is checked against.
    boxRoutes[`GET /2.0/files/${id}/content`] = (_, res) => { res.writeHead(302, { location: `${dl.base}/d?size=${byId.get(id)!.size / MB}` }); res.end(); };
  const box = await fakeServer(boxRoutes);

  const google = await fakeServer({
    "POST /token": o.googleTokenRoute ?? ((_, res) => json(res, 200, { access_token: "g-access", expires_in: 3599 })),
    "GET /drive/v3/files": (_, res) => json(res, 200, { files: Object.entries(DRIVE_DOCS).map(([id, d]) => ({ id, name: d.name })) }),
    ...Object.fromEntries(Object.entries(DRIVE_DOCS).map(([id, d]) => [`GET /drive/v3/files/${id}/export`, (_: unknown, res: Parameters<typeof json>[0]) => { res.writeHead(200); res.end(d.text); }])),
  });
  const dropbox = await fakeServer({
    "POST /oauth2/token": o.dropboxTokenRoute ?? ((_, res) => json(res, 200, { access_token: "d-access", expires_in: 14400 })),
    "POST /2/files/list_folder": (_, res) =>
      json(res, 200, { entries: [...Object.entries(PAPER_DOCS).map(([id, d]) => ({ ".tag": "file", id, name: d.name })), { ".tag": "folder", id: "id:f", name: "Show notes" }], has_more: false, cursor: "c" }),
    "POST /2/files/get_metadata": (req, res) => json(res, 200, { id: JSON.parse(req.body).path, export_info: { export_options: PAPER_DOCS[JSON.parse(req.body).path]!.options } }),
    "POST /2/files/export": (req, res) => { res.writeHead(200); res.end(PAPER_DOCS[JSON.parse(String(req.headers["dropbox-api-arg"])).path]!.text); },
  });

  // Downloads in the fake world are sized in bytes = listed size / 1 MB, so the size check is against that.
  const http = testHttp();
  const realBox = boxClient(http, { clientId: "bid", clientSecret: "bsecret", enterpriseId: "777" }, { api: box.base, isDownloadHost: (u) => u.origin === dl.base });
  const scaledBox = { items: realBox.items, download: (id: string, dest: string, size: number) => realBox.download(id, dest, size / MB) };
  const cv = fakeConvex();
  const logs: string[] = [];
  const deps: ScanDeps = {
    convex: cv.convex, log: (l) => logs.push(l), memory: newMemory(), tokenDir, inboxDir, preparedDir,
    box: o.box === false ? null : { client: scaledBox, folderId: "123", key: "box-key" },
    google: (rt) => driveClient(http, { clientId: "gid", clientSecret: "gsecret" }, rt, { tokenUrl: `${google.base}/token`, api: `${google.base}/drive/v3` }),
    dropbox: (rt) => dropboxClient(http, { clientId: "did", clientSecret: "dsecret" }, rt, { tokenUrl: `${dropbox.base}/oauth2/token`, api: `${dropbox.base}/2`, content: `${dropbox.base}/2` }),
  };
  const close = async () => { for (const s of [dl, box, google, dropbox]) await s.close(); };
  return { deps, cv, logs, box, google, dropbox, dl, tokenDir, inboxDir, preparedDir, write, close };
}
