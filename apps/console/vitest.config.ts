import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "console",
    include: ["src/**/*.test.{ts,tsx}", "convex/**/*.test.ts"],
    // Convex tests opt in with `// @vitest-environment edge-runtime`, so React tests can use jsdom.
    server: { deps: { inline: ["convex-test"] } },
  },
});
