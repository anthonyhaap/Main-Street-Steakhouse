import { expect, test } from "@playwright/test";

test("each dead end says what the manager can actually do about it", async ({ page }) => {
  await page.goto("/preview/notifications");

  // Blocked is the one that matters most: script cannot re-ask, so the card has
  // to send them somewhere rather than offer a button that will not work.
  await page.getByRole("button", { name: "denied", exact: true }).click();
  await expect(page.getByText(/blocked notifications for this site/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Turn on for this device/ })).toHaveCount(0);

  // An iPhone can do this, but only from the home screen — worth naming the
  // steps, because it is a thing the manager can go and do.
  await page.getByRole("button", { name: "ios-needs-install" }).click();
  await expect(page.getByText(/Add to Home Screen/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Turn on for this device/ })).toHaveCount(0);

  // The App Store build has no site settings to send them to; the phone's own
  // Settings app is the only way back, so the card names the path.
  await page.getByRole("button", { name: "ios-app-denied" }).click();
  await expect(page.getByText(/Settings, then Notifications, then Steakhouse/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Turn on for this device/ })).toHaveCount(0);

  await page.getByRole("button", { name: "unsupported" }).click();
  await expect(page.getByText(/can't do notifications/)).toBeVisible();
});

test("the switch reads as on or off, and only then offers to change", async ({ page }) => {
  await page.goto("/preview/notifications");

  await expect(page.getByText("Off on this device.")).toBeVisible();
  await page.getByRole("button", { name: "Turn on for this device" }).click();
  await expect(page.getByText("On for this device.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn off on this device" })).toBeVisible();
});

test("the kinds follow the account, and say so", async ({ page }) => {
  await page.goto("/preview/notifications");

  const trades = page.getByLabel("Trade offers and answers");
  const waivers = page.getByLabel("Waiver results");
  await expect(trades).toBeChecked();
  await expect(waivers).toBeChecked();

  await trades.uncheck();
  await expect(trades).not.toBeChecked();
  await expect(waivers).toBeChecked();

  await expect(page.getByText(/follow your account, not this device/)).toBeVisible();
  // The promise that this stays a small feature, written on the screen.
  await expect(page.getByText(/scores, chat and the feed are all yours to look up/)).toBeVisible();
});

test("a device count is shown once there is one", async ({ page }) => {
  await page.goto("/preview/notifications");
  await expect(page.getByText("2 devices")).toBeVisible();
});
