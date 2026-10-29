import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts", "deploy/*.test.ts"],
        },
      },
      "apps/console",
      "apps/bridge",
      "apps/relay",
      "apps/media",
      "apps/publisher",
      "apps/ingest",
    ],
  },
});
