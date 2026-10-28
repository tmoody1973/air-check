import { join } from "node:path";
import { assembleEpisode, showDateFromTitle } from "@aircheck/core";
import type { BoxClient } from "./box.js";
import { buildEpisodes, type BoxFolder, type DriveDoc, type PaperDoc } from "./build.js";
import type { IngestConvex, SourceReport } from "./convex.js";
import { onDisk } from "./disk.js";
import type { DriveClient } from "./drive.js";
import type { DropboxClient } from "./dropbox.js";
import { AuthRefused, HttpError } from "./http.js";
import { readTokenFile, refusalKey } from "./tokens.js";

type SourceName = SourceReport["source"];
export interface SourceMemory {
  /** Refused credentials, by hash, with the provider's code: never tried again (R13). Lives as long as the process. */
  refused: Map<string, string>;
  /** The last status sent per source; a status is sent only when it changes. */
  reported: Map<SourceName, string>;
}
export const newMemory = (): SourceMemory => ({ refused: new Map(), reported: new Map() });

export interface ScanDeps {
  convex: IngestConvex; log: (line: string) => void; memory: SourceMemory;
  tokenDir: string; inboxDir: string; preparedDir: string;
  /** null: BOX_* not set. */
  box: { client: BoxClient; folderId: string } | null;
  /** null: the app's client id/secret are not set. Called with the token file's refresh token, once per scan. */
  google: ((refreshToken: string) => DriveClient) | null;
  dropbox: ((refreshToken: string) => DropboxClient) | null;
}

/** R3: 2026 dates only. */
const is2026 = (date: string) => date.startsWith("2026-");
const dated = (name: string) => {
  const d = showDateFromTitle(name);
  return d.ok && is2026(d.date) ? d.date : null;
};
const push = <T>(m: Map<string, T[]>, k: string, v: T) => void m.set(k, [...(m.get(k) ?? []), v]);
/** Hard Rule 8: a short code, never a message that could carry a URL or a token. */
const code = (e: unknown) => (e instanceof HttpError || e instanceof AuthRefused ? e.message : "network");

async function report(deps: ScanDeps, r: SourceReport): Promise<void> {
  const key = JSON.stringify(r);
  if (deps.memory.reported.get(r.source) === key) return;
  try {
    await deps.convex.sourceStatus(r);
    deps.memory.reported.set(r.source, key);
  } catch {
    deps.log(`ingest step=source_status source=${r.source} ok=false`);
  }
}

/**
 * Reads one source. A refused credential is remembered and reported as needs_reconnect (Settings and Episodes say
 * "Reconnect needed"); a provider that is merely down is skipped this scan with its status left alone.
 */
async function guarded<T>(deps: ScanDeps, source: SourceName, key: string | null, account: string | undefined, read: () => Promise<{ value: T; count: number }>): Promise<T | null> {
  const who = account ? { account } : {};
  const refused = key === null ? undefined : deps.memory.refused.get(key);
  if (refused) {
    await report(deps, { source, state: "needs_reconnect", ...who, lastError: refused });
    return null;
  }
  const t0 = Date.now();
  try {
    const { value, count } = await read();
    deps.log(`ingest step=scan source=${source} ok=true count=${count} ms=${Date.now() - t0}`);
    await report(deps, { source, state: "connected", ...who });
    return value;
  } catch (e) {
    deps.log(`ingest step=scan source=${source} ok=false error=${code(e)}`);
    if (e instanceof AuthRefused) {
      if (key !== null) deps.memory.refused.set(key, e.code);
      await report(deps, { source, state: "needs_reconnect", ...who, lastError: e.code });
    }
    return null;
  }
}

/** A Connect-button source's token file, or the status that explains why there is none (R13). */
async function tokenFor(deps: ScanDeps, source: "google" | "dropbox", configured: boolean) {
  if (!configured) return void (await report(deps, { source, state: "not_connected", lastError: "not_configured" }));
  const t = await readTokenFile(join(deps.tokenDir, `${source}.json`));
  if (t.kind === "missing") return void (await report(deps, { source, state: "not_connected", lastError: "no_token" }));
  if (t.kind === "invalid") return void (await report(deps, { source, state: "needs_reconnect", lastError: "invalid_token_file" }));
  return { ...t, key: refusalKey(source, t.refreshToken, t.connectedAt ?? null) };
}

async function readBox(deps: ScanDeps): Promise<Map<string, BoxFolder[]> | null> {
  if (!deps.box) {
    await report(deps, { source: "box", state: "not_connected", lastError: "not_configured" });
    return null;
  }
  const { client, folderId } = deps.box;
  // Box has no Reconnect button: the fix is an admin authorising the app, with the same credentials. So a refusal is
  // not remembered; it is tried again next scan (once an hour, not a loop) and needs no restart once fixed.
  return guarded(deps, "box", null, undefined, async () => {
    const byDate = new Map<string, BoxFolder[]>();
    for (const f of await client.items(folderId)) {
      const date = f.type === "folder" ? dated(f.name) : null;
      if (!date) continue; // older years, and folders with no date at all (nothing to attach them to)
      const files = (await client.items(f.id)).filter((x) => x.type === "file").map(({ id, name, size }) => ({ id, name, size }));
      push(byDate, date, { id: f.id, name: f.name, assembly: assembleEpisode(f.name, files) });
    }
    return { value: byDate, count: byDate.size };
  });
}

async function readDrive(deps: ScanDeps): Promise<Map<string, DriveDoc[]> | null> {
  const t = await tokenFor(deps, "google", !!deps.google);
  if (!t) return null;
  return guarded(deps, "google", t.key, t.account, async () => {
    const drive = deps.google!(t.refreshToken);
    const byDate = new Map<string, DriveDoc[]>();
    for (const d of await drive.listDocs()) {
      const date = dated(d.name);
      if (date) push(byDate, date, { id: d.id, name: d.name, text: await drive.exportText(d.id) });
    }
    return { value: byDate, count: byDate.size };
  });
}

async function readPaper(deps: ScanDeps): Promise<Map<string, PaperDoc[]> | null> {
  const t = await tokenFor(deps, "dropbox", !!deps.dropbox);
  if (!t) return null;
  return guarded(deps, "dropbox", t.key, t.account, async () => {
    const dbx = deps.dropbox!(t.refreshToken);
    const byDate = new Map<string, PaperDoc[]>();
    // R3: .paper files named for a 2026 show that mention Rhythm Lab, anywhere in the Dropbox.
    for (const f of await dbx.listFiles()) {
      const date = /\.paper$/i.test(f.name) && /rhythm lab/i.test(f.name) ? dated(f.name) : null;
      if (date) push(byDate, date, { id: f.id, name: f.name, export: await dbx.exportText(f.id) });
    }
    return { value: byDate, count: byDate.size };
  });
}

/**
 * One scan (hourly). Every source is read and its status reported. Episodes are stored only when all three were read:
 * a scan missing one would replace good facts with gaps (no audio, no tracklist, no notes) and could let a show be
 * drafted without its notes. So a down source holds the backlog where it was until it is back.
 */
export async function runScan(deps: ScanDeps): Promise<void> {
  const t0 = Date.now();
  const box = await readBox(deps);
  const drive = await readDrive(deps);
  const paper = await readPaper(deps);
  if (!box || !drive || !paper) {
    const down = [!box && "box", !drive && "google", !paper && "dropbox"].filter(Boolean).join("_");
    deps.log(`ingest step=scan ok=false reason=${down}_unavailable stored=0`);
    return;
  }
  const [{ episodes: stored }, disk] = await Promise.all([deps.convex.list(), onDisk(deps.inboxDir, deps.preparedDir)]);
  let ok = 0;
  let questions = 0;
  const episodes = buildEpisodes({ box, drive, paper }, stored, disk.complete);
  for (const e of episodes) {
    questions += e.questions.length;
    try {
      await deps.convex.upsert(e);
      ok++;
    } catch {
      deps.log(`ingest date=${e.showDate} step=upsert ok=false`);
    }
  }
  deps.log(`ingest step=scan ok=${ok === episodes.length} stored=${ok} questions=${questions} ms=${Date.now() - t0}`);
}
