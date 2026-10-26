import { expect, test } from "@playwright/test";

/**
 * A manager's Sundays, and a rivalry's.
 *
 * Read on the client from the events the game center stored (`sundayLine`,
 * `rivalrySundays`): /preview/history gives Anthony three Sundays, and
 * /preview/matchups gives two of its three pairings one each.
 */

test("a profile carries his Sundays: what he did, and what was done to him", async ({ page }) => {
  await page.goto("/preview/history?manager=Anthony");
  const sun = page.getByLabel("On Sundays");
  await expect(sun).toContainText("On Sundays · 3 on record");
  const stat = (label: string) => sun.locator("div", { has: page.locator("dt", { hasText: label }) }).locator("dd");
  await expect(stat("Leads taken")).toHaveText("3"); // a lead change, a late one, and a touchdown that took it
  await expect(stat("Leads lost")).toHaveText("3");
  await expect(stat("Taken late")).toHaveText("1");
  await expect(stat("Comebacks")).toHaveText("1");
  await expect(stat("Blown leads")).toHaveText("1");
  await expect(stat("Monster games")).toHaveText("1");
  await expect(sun).toContainText("Deepest comeback: 21.5 down against Dave, 2026 week 7.");
  await expect(sun).toContainText("Worst collapse: 24.1 up on Marcus, and lost the lead, 2026 week 5.");
  await expect(sun).toContainText("Biggest game: Puka Nacua, 34.2, 2026 week 6.");
});

test("a manager with no stored Sunday gets no line, not a row of zeros", async ({ page }) => {
  await page.goto("/preview/history?manager=Jules");
  await expect(page.getByRole("region", { name: "Jules's career" })).toBeVisible();
  await expect(page.getByLabel("On Sundays")).toHaveCount(0);
});

test("a rivalry card tells the Sundays the two have shared", async ({ page }) => {
  await page.goto("/preview/matchups");
  const ray = page.locator(".riv", { hasText: "against Dev" });
  await ray.locator(".riv__head").click();
  await expect(ray).toContainText("The lead changed hands 3 times in 1 Sunday · Jared Goff had 32.5 for Dev, 2026 week 5");
  const anthony = page.locator(".riv", { hasText: "Anthony leads Marcus" });
  await anthony.locator(".riv__head").click();
  await expect(anthony).toContainText("The lead changed hands once in 1 Sunday · Marcus came back from 18.2 down, 2026 week 6");
});
