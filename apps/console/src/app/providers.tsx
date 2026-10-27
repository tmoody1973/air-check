"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // Created lazily so a build with no env still works; the URL is read when the provider mounts.
  const [convex] = useState(() => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:0"));
  return (
    <ClerkProvider telemetry={false} signInUrl="/sign-in" signInFallbackRedirectUrl="/today">
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
