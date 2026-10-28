/**
 * Hard Rule 8: the only log line, `publish package=<id> step=<step> ok=<bool> ms=<n>`. Never a token, URL, title,
 * description or file path. `ok` decides from the value; a throw logs ok=false and is rethrown.
 */
export async function timed<T>(log: (line: string) => void, packageId: string, step: string, fn: () => Promise<T>, ok: (v: T) => boolean = () => true): Promise<T> {
  const t0 = Date.now();
  const line = (good: boolean) => log(`publish package=${packageId} step=${step} ok=${good} ms=${Date.now() - t0}`);
  try {
    const v = await fn();
    line(ok(v));
    return v;
  } catch (e) {
    line(false);
    throw e;
  }
}
