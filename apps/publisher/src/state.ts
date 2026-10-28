import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

/** What must survive a restart: which ready cards went out, and a hash (never the key) of the connection Mixcloud refused. */
export interface PublisherState { sentCards: string[]; rejectedToken?: string }
export interface StateBox { get(): PublisherState; update(change: (s: PublisherState) => PublisherState): Promise<void> }

/** Missing or unreadable state starts empty. Every update is written whole and renamed into place (atomic). */
export async function openState(path: string): Promise<StateBox> {
  let current: PublisherState = { sentCards: [] };
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<PublisherState>;
    current = {
      sentCards: Array.isArray(raw.sentCards) ? raw.sentCards.filter((x): x is string => typeof x === "string") : [],
      ...(typeof raw.rejectedToken === "string" ? { rejectedToken: raw.rejectedToken } : {}),
    };
  } catch { /* first run, or a damaged file: start empty */ }
  return {
    get: () => current,
    async update(change) {
      current = change(current);
      // The publish and card loops can overlap, so each write gets its own temp name.
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(current), { mode: 0o600 });
      await rename(tmp, path);
    },
  };
}
