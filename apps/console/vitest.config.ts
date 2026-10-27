import { defineConfig } from "vitest/config";

import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "console",
    include: ["src/**/*.test.{ts,tsx}", "convex/**/*.test.ts"],
    // Convex tests opt in with `// @vitest-environment edge-runtime`, so React tests can use jsdom.
    server: { deps: { inline: ["convex-test"] } },
  },
});
