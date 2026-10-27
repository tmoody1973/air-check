import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
        },
      },
      "apps/console",
    ],
  },
});
