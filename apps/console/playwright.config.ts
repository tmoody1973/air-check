import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
export const STORAGE_STATE = "e2e/.auth/demo.json";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1, // ponytail: one worker, the approve test mutates shared demo data
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `NEXT_DIST_DIR=.next-e2e pnpm dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "iPhone 13", use: { ...devices["iPhone 13"], storageState: STORAGE_STATE }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
    { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
});
