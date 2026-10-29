import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { appOrigin } from "./app-origin";

// The security pieces every Connect flow shares (Mixcloud, Google Drive, Dropbox). Server only.

export const newState = () => randomBytes(32).toString("base64url");

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Constant time for equal lengths; length itself is not secret (always 43 chars). */
export function statesMatch(expected: string | undefined, got: string | undefined): boolean {
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** CSRF guard for cookie-authenticated POSTs: the browser's Origin must be the console's own. */
export function sameOrigin(request: Request): boolean {
  const origin = appOrigin();
  return !!origin && request.headers.get("origin") === origin;
}

/** Temp file in the same folder, then rename, so a reader never sees half a file. Mode set after write so umask can't change it. */
export async function writeTokenFile(path: string, data: object): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    await chmod(tmp, 0o640);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Deletes the token file; a missing file is already the goal. */
export const removeTokenFile = (path: string) => rm(path, { force: true });
