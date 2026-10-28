import { expect, test } from "@playwright/test";

/**
 * How to put the league on a phone.
 *
 * Public, so it needs no fixture: the page reads nothing. The assertions are
 * the steps, because the steps are the product — the first-visit nudge shows
 * them once and this is the only way back to them.
 */

test("the page is open before sign-in, and says there is nothing to pay", async ({ page }) => {
  await page.goto("/install");
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Install the app");
  await expect(page.getByText(/No app store, nothing to pay/)).toBeVisible();
});

test("both phones get their taps, in words", async ({ page }) => {
  await page.goto("/install");
  const iphone = page.getByRole("region", { name: "iPhone" });
  await expect(iphone.getByText("Add to Home Screen")).toBeVisible();
  await expect(iphone.getByText(/Safari/)).toBeVisible();

  const android = page.getByRole("region", { name: "Android" });
  await expect(android.getByText("Add to Home screen")).toBeVisible();
  await expect(android.getByText(/Chrome/)).toBeVisible();
});

test("it says what installing is for", async ({ page }) => {
  await page.goto("/install");
  await expect(page.getByText(/only from the home screen/)).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});
