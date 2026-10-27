import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@aircheck/core"],
  // Docker image: self-contained server. Trace from the repo root so packages/core is included;
  // server.js then lands at .next/standalone/apps/console/server.js.
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
  // e2e runs its own dev server beside the one a developer already has open; Next locks one per distDir.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default config;
