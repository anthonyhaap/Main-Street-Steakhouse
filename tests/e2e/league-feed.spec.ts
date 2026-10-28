import { expect, test } from "@playwright/test";

test("the League Feed is behind the session", async ({ page }) => {
  await page.goto("/league-feed");
  await expect(page).toHaveURL(/\/login/);
});

test("events and league news sit in one column", async ({ page }) => {
  await page.goto("/preview/league-feed");

  await expect(page.getByText("Chuck Wagon and Gridiron Butchers made a trade")).toBeVisible();
  await expect(page.getByText("Waivers cleared: 4 of 7 claims awarded")).toBeVisible();
  await expect(page.getByText("Week 3").first()).toBeVisible();
  await expect(page.getByText("The House", { exact: true }).first()).toBeVisible();
});

test("an empty League Feed explains what will fill it", async ({ page }) => {
  await page.goto("/preview/league-feed");
  await page.getByRole("button", { name: "Quiet" }).click();
  await expect(page.getByText(/Signings, waiver results, trades and league news land here/)).toBeVisible();
});

test("a reaction is a toggle, and says who is in the count", async ({ page }) => {
  await page.goto("/preview/league-feed");

  const flame = page.getByRole("button", { name: /^🔥 5, including you$/ });
  await expect(flame).toBeVisible();
  await expect(flame).toHaveAttribute("aria-pressed", "true");

  await flame.click();
  await expect(page.getByRole("button", { name: /^🔥 4$/ })).toBeVisible();

  await page.getByRole("button", { name: /^🔥 4$/ }).click();
  await expect(page.getByRole("button", { name: /^🔥 5, including you$/ })).toBeVisible();
});

test("a commissioner's announcement holds the rail above the feed", async ({ page }) => {
  await page.goto("/preview/league-feed");
  await expect(page.getByText("Draft moves to Thursday at 8pm — same slots, new night.").first()).toBeVisible();
  await expect(page.getByText(/^Pinned · Ada$/)).toBeVisible();
});

test("Sunday Live pins as the house, not the commissioner", async ({ page }) => {
  await page.goto("/preview/league-feed");
  await expect(page.getByText(/Sunday Live — talk trash/).first()).toBeVisible();
  await expect(page.getByText(/^Pinned · The House$/)).toBeVisible();
});

test("only the commissioner may unpin an announcement, and Sunday Live cannot be", async ({ page }) => {
  await page.goto("/preview/league-feed");

  // Two pinned lines, one unpinnable button — Sunday Live closes on its own.
  await expect(page.getByRole("button", { name: "Unpin this announcement" })).toHaveCount(1);

  await page.getByRole("button", { name: "Manager" }).click();
  await expect(page.getByRole("button", { name: "Unpin this announcement" })).toHaveCount(0);
  await expect(page.getByText("Draft moves to Thursday at 8pm — same slots, new night.").first()).toBeVisible();
});

test("unpinning takes an announcement off the rail without deleting it", async ({ page }) => {
  await page.goto("/preview/league-feed");

  await page.getByRole("button", { name: "Unpin this announcement" }).click();
  await expect(page.getByText(/^Pinned · Ada$/)).toHaveCount(0);
  await expect(page.getByText("Draft moves to Thursday at 8pm — same slots, new night.")).toBeVisible();
});

test("a weekly award reads as a record of the week, like a trade or a waiver", async ({ page }) => {
  await page.goto("/preview/league-feed");
  await expect(page.getByText("Player of the week: Ja'Marr Chase")).toBeVisible();
  await expect(page.getByText("38.4 for Chuck Wagon · Week 2")).toBeVisible();
});
