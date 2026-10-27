import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { SandboxChipLive } from "@/components/SandboxChipLive";
import { SandboxChipProvider, WorkspaceProvider } from "@/components/Shell";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  // Display only: which sidebar footer to show. Data isolation is enforced in Convex.
  const { sessionClaims } = await auth();
  const workspace = sessionClaims?.role === "demo" ? "demo" : "real";
  return (
    <WorkspaceProvider value={workspace}>
      <SandboxChipProvider value={<SandboxChipLive />}>{children}</SandboxChipProvider>
    </WorkspaceProvider>
  );
}
