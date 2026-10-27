"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { appOrigin } from "../lib/app-origin";
import { PlayerProvider } from "../components/PlayerProvider";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // Created lazily so a build with no env still works; the URL is read when the provider mounts.
  const [convex] = useState(() => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:0"));
  // Production pins redirects to the console's own origin; unset (dev, CI) keeps Clerk's default.
  const origin = appOrigin();
  return (
    <ClerkProvider
      telemetry={false}
      signInUrl="/sign-in"
      signInFallbackRedirectUrl="/today"
      {...(origin ? { allowedRedirectOrigins: [origin] } : {})}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <PlayerProvider>{children}</PlayerProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
