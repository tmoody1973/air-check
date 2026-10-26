import type { PackageRecord, PackageStore } from "../../src/index";

/** In-memory store. compareAndSwap checks and writes with no await in between, so it is atomic in the event loop. */
export function memoryStore(): PackageStore {
  const rows = new Map<string, PackageRecord>();
  return {
    async get(id) {
      const r = rows.get(id);
      return r ? structuredClone(r) : null;
    },
    async put(rec) {
      rows.set(rec.draft.id, structuredClone(rec));
    },
    async compareAndSwap(id, expected, next) {
      const cur = rows.get(id);
      if (!cur || cur.status !== expected.status) return null;
      if (expected.fingerprint !== undefined && cur.fingerprint !== expected.fingerprint) return null;
      const updated = { ...cur, ...structuredClone(next) };
      rows.set(id, updated);
      return structuredClone(updated);
    },
  };
}
