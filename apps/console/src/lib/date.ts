const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-02" -> "Oct 2, 2026". Pure string math so no locale or timezone can change it. */
export function showDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

/** An instant (ms) as its calendar date in Milwaukee, the station's time zone: "Oct 27, 2026". */
export function chicagoDateLabel(ms: number): string {
  return showDateLabel(new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
}
