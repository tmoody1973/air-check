import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { appOrigin } from "./lib/app-origin";

const origin = appOrigin();
// The AgentMail webhook is exactly one path, not a prefix: its own check is the Svix signature in the route.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/demo", "/api/agentmail/inbound"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
}, {
  signInUrl: "/sign-in",
  // Production only: reject session tokens minted for any other origin (subdomain cookie leaks).
  ...(origin ? { authorizedParties: [origin] } : {}),
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
