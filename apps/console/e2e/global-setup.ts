import { clerkSetup } from "@clerk/testing/playwright";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

// Loads the Clerk/Convex keys without printing them, re-seeds the demo rows, gets a Clerk testing token.
export default async function globalSetup() {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
  process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  execSync("pnpm seed:demo", { cwd: resolve(import.meta.dirname, "../../.."), stdio: "ignore" });
  await clerkSetup();
}
