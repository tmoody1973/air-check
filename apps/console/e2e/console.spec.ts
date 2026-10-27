import { expect, test } from "@playwright/test";

const LONG = "/packages/demo-long-title";
const GOLDEN = "/packages/demo-10-2-26";
const desktopOnly = (name: string) => test.skip(name !== "Desktop Chrome", "runs once, in the Desktop project");

test("package page fits a 375px phone", async ({ page }, info) => {
  test.skip(info.project.name !== "iPhone 13", "phone project only");
  // scrollWidth can never be below the viewport, and iPhone 13 is 390 wide: shrink to the brief's 375 so the check can fail.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(LONG);
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  for (const name of ["Approve", "Edit", "Skip"]) {
    const el = page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true })).first();
    await el.scrollIntoViewIfNeeded();
    await expect(el).toBeInViewport();
    expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("tracklist page fits a 375px phone", async ({ page }, info) => {
  test.skip(info.project.name !== "iPhone 13", "phone project only");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/tracklist");
  const button = page.getByRole("button", { name: "Draft package" });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("demo approve flow", async ({ page }, info) => {
  desktopOnly(info.project.name); // approving twice would find the package already approved
  await page.goto("/today");
  await page.getByRole("link", { name: "Review" }).first().click();
  await expect(page).toHaveURL(/\/packages\//);
  await page.goto(GOLDEN);
  await expect(page.getByText("Draft · 2 flags")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved · sample, not published")).toBeVisible();
  await page.goto("/trust");
  await expect(page.getByText(/Approved package/).first()).toBeVisible();
});

test("today blocked card links to blocked filter", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("link", { name: "See audit log" }).click();
  await expect(page).toHaveURL(/\/trust\?filter=blocked/);
});

test("player jump to hour 2", async ({ page }) => {
  await page.goto(GOLDEN);
  await page.getByRole("button", { name: /play/i }).first().click();
  await page.getByRole("button", { name: "Jump to hour 2" }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector("audio")!.currentTime)).toBeGreaterThanOrEqual(10);
});

test("signed-out visit to a package redirects to sign-in with redirect_url", async ({ browser }, info) => {
  desktopOnly(info.project.name);
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto(GOLDEN);
  await page.waitForURL(/\/sign-in/);
  // Clerk stores redirect_url as an absolute URL.
  const back = new URL(new URL(page.url()).searchParams.get("redirect_url")!, page.url());
  expect(back.pathname).toBe(GOLDEN);
  await ctx.close();
});
