import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "publisher",
    include: ["test/**/*.test.ts"],
  },
});
