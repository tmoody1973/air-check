const TZ = "America/Chicago";
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});

function wall(ms: number) {
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(ms)) p[x.type] = Number(x.value);
  const [y = 0, m = 1, d = 1, h = 0, mi = 0, se = 0] = ["year", "month", "day", "hour", "minute", "second"].map((k) => p[k]);
  return { y, m, d, asUtc: Date.UTC(y, m - 1, d, h, mi, se) };
}

/** Chicago's UTC offset in ms at an instant (negative: behind UTC). DST-correct via Intl. */
const offsetAt = (ms: number) => wall(Math.floor(ms / 1000) * 1000).asUtc - Math.floor(ms / 1000) * 1000;

/** Epoch ms of 18:00 America/Chicago on the calendar day before `now` (in Chicago). */
export function digestCutoff(now: number): number {
  const { y, m, d } = wall(now);
  const guess = Date.UTC(y, m - 1, d - 1, 18);
  // Offset can differ between the guess and the result across a DST change, so settle it in two passes.
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}
