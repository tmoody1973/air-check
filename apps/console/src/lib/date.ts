const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-02" -> "Oct 2, 2026". Pure string math so no locale or timezone can change it. */
export function showDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

/** An instant (ms) as its calendar date in Milwaukee, the station's time zone, plus whole days: "Oct 27, 2026". */
export function chicagoDateLabel(ms: number, plusDays = 0): string {
  const [y, m, d] = new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).split("-").map(Number);
  // Calendar math on a UTC date, so a DST change can never skip or repeat a day.
  return showDateLabel(new Date(Date.UTC(y!, m! - 1, d! + plusDays)).toISOString());
}

const chicagoTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

/** An ISO instant as Milwaukee date and clock time: "Oct 27, 2026, 10:04 PM". Unparseable input comes back as is. */
export function chicagoTimeLabel(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : chicagoTime.format(ms);
}
