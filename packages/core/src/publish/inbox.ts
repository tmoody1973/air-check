export type InboxMatch = { ok: true; showDate: string; hour1: string; hour2: string } | { ok: false; reason: string };

const isRealDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Numeric value of the leading digits, or null when the name has none. */
const leadingNumber = (name: string): number | null => {
  const m = /^\d+/.exec(name);
  return m ? Number(m[0]) : null;
};

/** Picks hour 1 and hour 2 from an inbox folder named for the show date. Other files are ignored. */
export function matchInbox(folder: string, files: string[]): InboxMatch {
  if (!isRealDate(folder)) return { ok: false, reason: `"${folder}" is not a show date folder (expected YYYY-MM-DD)` };
  const wavs = files.filter((f) => /\.wav$/i.test(f));
  if (wavs.length !== 2) {
    const others = files.length - wavs.length;
    const extra = others ? ` (ignored ${others} other file${others === 1 ? "" : "s"})` : "";
    return { ok: false, reason: `${folder} needs exactly two .wav files; found ${wavs.length}${extra}` };
  }
  const [n1, n2] = wavs as [string, string];
  const a = { name: n1, key: leadingNumber(n1) };
  const b = { name: n2, key: leadingNumber(n2) };
  if (a.key !== null && a.key === b.key) {
    return { ok: false, reason: `${folder}: ${a.name} and ${b.name} start with the same number, so the order is unclear` };
  }
  const cmp = a.key !== null && b.key !== null ? a.key - b.key : a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.name < b.name ? -1 : 1);
  const [first, second] = cmp <= 0 ? [a, b] : [b, a];
  return { ok: true, showDate: folder, hour1: first.name, hour2: second.name };
}
