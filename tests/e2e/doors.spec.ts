import { expect, test } from "@playwright/test";

/**
 * The way in.
 *
 * The real doors only open on the far side of a password, so the fixture at
 * /preview/doors is what a test can hold: the same component, the same
 * handover, and a list on the page that records what ran while the screen was
 * white. What matters here is not how it looks but that it always lets go —
 * the overlay hands over exactly once and then takes itself off the screen.
 */

test("the doors open, hand over once, and get out of the way", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/doors");

  await expect(page.locator(".doors")).toHaveCount(0);
  await page.getByRole("button", { name: "Open the doors" }).click();

  // Two leaves, and the house mark cut across both of them.
  await expect(page.locator(".doors")).toBeVisible();
  await expect(page.locator(".doors__leaf")).toHaveCount(2);
  await expect(page.locator(".doors__plate")).toHaveCount(2);

  // The handover happens under the white, before the smoke clears.
  await expect(page.getByTestId("door-entry")).toHaveCount(1);

  // And nothing is left on top of the page it just revealed.
  await expect(page.locator(".doors")).toHaveCount(0, { timeout: 6000 });
  await expect(page.getByRole("button", { name: "Open the doors" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a manager who asked for less motion just walks in", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/preview/doors");

  await page.getByRole("button", { name: "Open the doors" }).click();

  // No doors at all, and the handover has already happened.
  await expect(page.getByTestId("door-entry")).toHaveCount(1);
  await expect(page.locator(".doors")).toHaveCount(0);
});
