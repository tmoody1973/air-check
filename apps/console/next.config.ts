import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@aircheck/core"],
  // e2e runs its own dev server beside the one a developer already has open; Next locks one per distDir.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default config;
