const MAX_KEYS = 10_000;

// ponytail: in-memory, per-process (fine for one VM). Empty keys are swept on each call and the map is capped at MAX_KEYS, oldest first. Move to Convex if we scale out.
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  const allow = (key: string, now: number = Date.now()): boolean => {
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const ok = recent.length < limit;
    if (ok) recent.push(now);
    hits.delete(key); // re-insert so Map order tracks recency
    if (recent.length) hits.set(key, recent);
    while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value as string);
    return ok;
  };
  return Object.assign(allow, { size: () => hits.size });
}
