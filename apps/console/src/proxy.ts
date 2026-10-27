import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { appOrigin } from "./lib/app-origin";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/demo"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
}, {
  signInUrl: "/sign-in",
  // Production only: reject session tokens minted for any other origin (subdomain cookie leaks).
  ...(appOrigin() ? { authorizedParties: [appOrigin()!] } : {}),
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
