import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { STORAGE_STATE } from "../playwright.config";

// Sign in once through /demo (rate-limited to 10/min) and let every other project reuse the session.
setup("sign in through /demo", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/demo");
  await page.waitForURL("**/today", { timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
