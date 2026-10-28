export interface ApprovedPackage {
  packageId: string;
  showDate: string;
  approvedAt: string;
}

/** Oldest showDate first, ties by approvedAt. The one ordering both functions share. */
const publishOrder = (a: ApprovedPackage, b: ApprovedPackage): number =>
  a.showDate.localeCompare(b.showDate) || a.approvedAt.localeCompare(b.approvedAt);

export function nextToPublish(
  approved: ApprovedPackage[],
  publishedToday: number,
  perDay = 3,
): { packageId: string } | { waitUntil: "tomorrow" } | null {
  if (approved.length === 0) return null;
  if (publishedToday >= perDay) return { waitUntil: "tomorrow" };
  const first = [...approved].sort(publishOrder)[0];
  return first ? { packageId: first.packageId } : null;
}

/** 0 = posts today, 1 = tomorrow, and so on. null when the package is not queued. */
export function publishDayOffset(approved: ApprovedPackage[], publishedToday: number, packageId: string, perDay = 3): number | null {
  const rank = [...approved].sort(publishOrder).findIndex((p) => p.packageId === packageId);
  return rank < 0 ? null : Math.floor((rank + publishedToday) / perDay);
}

const chicago = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of the America/Chicago calendar day containing the instant. Mirrors demoLimits.ts. */
export function chicagoDayKey(nowMs: number): string {
  const p = Object.fromEntries(chicago.formatToParts(nowMs).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
