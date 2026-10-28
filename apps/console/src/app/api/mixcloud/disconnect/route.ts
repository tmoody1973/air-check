import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { errorLocation, logStep, removeTokenFile, sameOrigin, tokenFilePath } from "@/lib/mixcloudOAuth";
import { realHumanSession } from "@/lib/session";

// The Settings card's Disconnect form. Cookie-authenticated, so a cross-site POST (no or foreign Origin) is refused.
const back = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await realHumanSession();
  if (!session) return new Response("Forbidden", { status: 403 });

  try {
    await removeTokenFile(tokenFilePath());
  } catch {
    logStep("remove", false);
    return back(errorLocation("write"));
  }
  try {
    const token = await session.convexToken();
    if (!token) throw new Error("no Convex token");
    await fetchMutation(api.mixcloud.disconnected, {}, { token });
  } catch {
    logStep("disconnect", false);
    return back(errorLocation("status"));
  }
  logStep("disconnect", true);
  return back("/settings?mixcloud=disconnected");
}
