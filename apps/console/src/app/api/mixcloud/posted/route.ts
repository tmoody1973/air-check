import { logStep, postedShows } from "@/lib/mixcloudOAuth";
import { realHumanSession } from "@/lib/session";

// Episodes' "Add a 2025 show" asks, before saving, whether Mixcloud already has a show for that date. A signed-in real
// human only (as the other Mixcloud routes); the lookup itself is a public GET with no credentials.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!(await realHumanSession())) return new Response("Forbidden", { status: 403 });
  const year = new URL(request.url).searchParams.get("year") ?? "";
  if (!/^\d{4}$/.test(year)) return json({ error: "year" }, 400);
  const shows = await postedShows(year);
  if (!shows) {
    logStep("posted", false);
    return json({ error: "unavailable" }, 502);
  }
  // Hard Rule 8: a count, never a name.
  console.info(`mixcloud step=posted ok=true count=${shows.length}`);
  return json(shows);
}
