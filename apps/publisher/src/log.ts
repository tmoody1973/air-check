/** A package id, a description update and its package (Plan 5c Task 4), or a research job (Plan 7). */
export type Who = string | { update: string; package: string } | { research: string };
export const whoTag = (who: Who) =>
  typeof who === "string" ? `package=${who}` : "research" in who ? `research=${who.research}` : `update=${who.update} package=${who.package}`;

/**
 * Hard Rule 8: the only log lines, `publish package=<id> step=<step> ok=<bool> ms=<n>` and, for a description update,
 * `publish update=<id> package=<id> step=...`. Never a token, URL, title, description or file path. `ok` decides from
 * the value; a throw logs ok=false and is rethrown.
 */
export async function timed<T>(log: (line: string) => void, who: Who, step: string, fn: () => Promise<T>, ok: (v: T) => boolean = () => true): Promise<T> {
  const t0 = Date.now();
  const line = (good: boolean) => log(`publish ${whoTag(who)} step=${step} ok=${good} ms=${Date.now() - t0}`);
  try {
    const v = await fn();
    line(ok(v));
    return v;
  } catch (e) {
    line(false);
    throw e;
  }
}
