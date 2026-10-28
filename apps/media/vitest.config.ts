import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "media",
    include: ["test/**/*.test.ts"],
  },
});
