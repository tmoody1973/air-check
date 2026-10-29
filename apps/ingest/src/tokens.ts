import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// The console's Connect Google / Connect Dropbox write {refresh_token, account, connectedAt} into INGEST_TOKEN_DIR
// (Task 3). Only this service reads them. The refresh token never leaves this process except in the token POST body.

export type TokenRead = { kind: "missing" } | { kind: "invalid" } | { kind: "unreadable" } | { kind: "ok"; refreshToken: string; account?: string; connectedAt?: number };

/** M4: the file is there but this service may not read it (wrong owner or mode): a deploy fix, not a Reconnect. */
const DENIED = new Set(["EACCES", "EPERM"]);

/** The console writes without an fsync, so an empty or half-written file is possible after a crash: `invalid`, never a guess. */
export async function readTokenFile(path: string): Promise<TokenRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    return code === "ENOENT" ? { kind: "missing" } : DENIED.has(code) ? { kind: "unreadable" } : { kind: "invalid" };
  }
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (typeof j.refresh_token !== "string" || !j.refresh_token) return { kind: "invalid" };
    return {
      kind: "ok", refreshToken: j.refresh_token,
      ...(typeof j.account === "string" && j.account ? { account: j.account } : {}),
      ...(typeof j.connectedAt === "number" ? { connectedAt: j.connectedAt } : {}),
    };
  } catch {
    return { kind: "invalid" };
  }
}

/**
 * A credential the provider refused is remembered as a hash (never the secret), so it is not tried again every scan
 * (R13, like the publisher's refused Mixcloud key). connectedAt is part of it: a Reconnect in Settings is always tried.
 */
export const refusalKey = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
