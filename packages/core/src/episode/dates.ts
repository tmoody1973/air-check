export type ShowDate = { ok: true; date: string } | { ok: false; reason: string };

// ponytail: first d-d-y group wins; titles carry one date. Accepts hyphen, en/em dash, dot, slash.
const DATE = /(?<!\d)(\d{1,2})\s*[-–—./]\s*(\d{1,2})\s*[-–—./]\s*(\d+)(?!\d)/;

/** ISO date from a Drive/Paper title (skills/rlr-source-reconciliation rule 6), or a plain refusal. Never guesses. */
export function showDateFromTitle(title: string): ShowDate {
  const m = title.match(DATE);
  if (!m) return { ok: false, reason: "No date found in the title." };
  const [month, day, yearText] = [Number(m[1]), Number(m[2]), m[3]!];
  if (yearText.length !== 2 && yearText.length !== 4)
    return { ok: false, reason: `The year "${yearText}" is not 2 or 4 digits, so the date needs a person to read it.` };
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return { ok: false, reason: `${month}-${day}-${yearText} is not a real calendar date.` };
  return { ok: true, date: d.toISOString().slice(0, 10) };
}

/** A real calendar date written yyyy-mm-dd. */
export function isShowDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}
