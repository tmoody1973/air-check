import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * What must survive a restart: which ready cards and which research cards went out (D12: kept apart, because ready
 * cards are pruned to the packages in review), and a hash (never the key) of the connection Mixcloud refused.
 */
export interface PublisherState { sentCards: string[]; sentResearch: string[]; rejectedToken?: string }
export interface StateBox { get(): PublisherState; update(change: (s: PublisherState) => PublisherState): Promise<void> }

/** Missing or unreadable state starts empty. Every update is written whole and renamed into place (atomic). */
export async function openState(path: string): Promise<StateBox> {
  let current: PublisherState = { sentCards: [], sentResearch: [] };
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<PublisherState>;
    current = {
      sentCards: ids(raw.sentCards),
      sentResearch: ids(raw.sentResearch),
      ...(typeof raw.rejectedToken === "string" ? { rejectedToken: raw.rejectedToken } : {}),
    };
  } catch { /* first run, or a damaged file: start empty */ }
  return {
    get: () => current,
    async update(change) {
      current = change(current);
      // The publish and card loops can overlap, so each write gets its own temp name.
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(current), { mode: 0o600 });
      await rename(tmp, path);
    },
  };
}
