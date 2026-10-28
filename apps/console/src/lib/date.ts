import { chicagoDayKey } from "@aircheck/core";
import { useEffect, useState } from "react";

export { chicagoDayKey };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-02" -> "Oct 2, 2026". Pure string math so no locale or timezone can change it. */
export function showDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

/** "2026-10-27" plus whole days, labelled: "Oct 29, 2026". Calendar math on a UTC date, so DST never skips a day. */
export function dayKeyLabel(key: string, plusDays = 0): string {
  const [y, m, d] = key.split("-").map(Number);
  return showDateLabel(new Date(Date.UTC(y!, m! - 1, d! + plusDays)).toISOString());
}

/** An instant (ms) as its calendar date in Milwaukee, the station's time zone, plus whole days: "Oct 27, 2026". */
export const chicagoDateLabel = (ms: number, plusDays = 0) => dayKeyLabel(chicagoDayKey(ms), plusDays);

/**
 * Today's Chicago day key, re-rendering once the day changes. Convex re-runs a query only when its data changes,
 * never when time passes, so a page open across midnight must ask again with the new day.
 * ponytail: a 60 s tick, so the switch lands within a minute of midnight.
 */
export function useChicagoDayKey(): string {
  const [key, setKey] = useState(() => chicagoDayKey(Date.now()));
  useEffect(() => {
    const id = setInterval(() => setKey(chicagoDayKey(Date.now())), 60_000);
    return () => clearInterval(id);
  }, []);
  return key;
}

const chicagoTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

/** An ISO instant as Milwaukee date and clock time: "Oct 27, 2026, 10:04 PM". Unparseable input comes back as is. */
export function chicagoTimeLabel(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : chicagoTime.format(ms);
}
