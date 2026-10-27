import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "console", include: ["src/**/*.test.{ts,tsx}"] },
});
