import { expect, test } from "@playwright/test";

/**
 * The manager's screens are behind the session.
 *
 * The NFL wire used to be a route handler proxying ESPN, and the test here kept
 * it from becoming an open relay. It is now a pair of tables loaded by pg_cron,
 * so the guard moved with it: `nfl_news` and `nfl_injuries` are RLS'd to league
 * members, and the pages that read them redirect when signed out.
 */

test("the team desk requires a session", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?next=%2Fteam|\/login\?next=\/team/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("a player page requires a session", async ({ page }) => {
  await page.goto("/player/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
