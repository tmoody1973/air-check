import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Workspace } from "./gate";

const WINDOW_MS = 10 * 60 * 1000;
const HOUR_MS = 3_600_000;
const ZONE = "America/Chicago";

const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const chicago = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Calendar date key and wall-clock ms since local midnight for an instant, in US Central time. */
function chicagoWall(ms: number): { day: string; sinceMidnight: number } {
  const p = Object.fromEntries(chicago.formatToParts(ms).map((x) => [x.type, x.value]));
  const sinceMidnight = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + (((ms % 1000) + 1000) % 1000);
  return { day: `${p.year}-${p.month}-${p.day}`, sinceMidnight };
}

/** The instant (ms) of the most recent America/Chicago midnight. Tries +-1 h around the wall-clock guess so 23/25-hour DST days work. */
export function chicagoDayStart(now: number): number {
  const { day, sinceMidnight } = chicagoWall(now);
  const guess = now - sinceMidnight;
  const starts = [-1, 0, 1].map((k) => guess + k * HOUR_MS).filter((c) => chicagoWall(c).day === day);
  return Math.min(...starts);
}

/** Demo rate-limit key: the session id claim when present, else the user id. */
export async function sessionKeyOf(ctx: MutationCtx): Promise<string | undefined> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) return undefined;
  const sid = (id as Record<string, unknown>).sid;
  return typeof sid === "string" && sid ? sid : id.subject;
}

/**
 * Decides how a new run executes. Real workspace: always live, no limits. Demo: RATE_LIMITED past
 * DEMO_RUNS_PER_SESSION (default 5) per rolling 10 min; scripted when DEMO_LIVE=0 or past
 * DEMO_LIVE_RUNS_PER_DAY (default 40) live runs per Chicago day.
 */
export async function sourceFor(ctx: MutationCtx, ws: Workspace, sessionKey: string | undefined, now: number): Promise<"live" | "scripted"> {
  if (ws === "real") return "live";
  const recent = await ctx.db
    .query("runs")
    .withIndex("by_session_created", (q) => q.eq("sessionKey", sessionKey).gt("createdAt", now - WINDOW_MS))
    .collect();
  if (recent.length >= intEnv("DEMO_RUNS_PER_SESSION", 5)) throw new ConvexError({ code: "RATE_LIMITED" });
  if (process.env.DEMO_LIVE === "0") return "scripted";
  const liveToday = await ctx.db
    .query("runs")
    .withIndex("by_workspace_source_created", (q) => q.eq("workspace", "demo").eq("source", "live").gte("createdAt", chicagoDayStart(now)))
    .collect();
  return liveToday.length >= intEnv("DEMO_LIVE_RUNS_PER_DAY", 40) ? "scripted" : "live";
}
