import { expect, test } from "@playwright/test";

/**
 * The rivalry, on the card.
 *
 * All of these numbers already existed on the history wall. What is being
 * tested here is that they now say something, in the one place where somebody
 * is about to play the man in question — and that the sentence is written from
 * the reader's side, because "Mike leads Ray 8-4" about your own game reads
 * like somebody else's fixture.
 */

test("your own record is written at you, and leads with the number", async ({ page }) => {
  await page.goto("/preview/matchups");

  const hero = page.locator(".sb[data-hero='true']");
  // Losing 4-8-1, and the run is the part that stings, so it is said out loud
  // rather than left to be inferred from a won-lost record.
  await expect(hero.locator(".riv__line")).toHaveText("You are 4-8-1 against Dev. He has won the last 3.");
});

test("a game between two other people is written about them", async ({ page }) => {
  await page.goto("/preview/matchups");

  const other = page.locator(".sb-list .sb").first();
  await expect(other.locator(".riv__line")).toHaveText("Anthony leads Marcus 5-4.");
  // One win is a result, not a run: a "streak" of one is nobody's streak.
  await expect(other.locator(".riv__line")).not.toContainText("won the last");
});

test("two managers who have never met say nothing at all", async ({ page }) => {
  await page.goto("/preview/matchups");

  // A card reading "they have never played" is a row that exists to report
  // its own emptiness. It should not be on the board.
  const cards = page.locator(".sb-list .sb");
  await expect(cards.nth(1).locator(".riv")).toHaveCount(0);
});

test("the detail is one tap, and does not repeat itself", async ({ page }) => {
  await page.goto("/preview/matchups");

  const hero = page.locator(".sb[data-hero='true']");
  await expect(hero.locator(".riv__detail")).toHaveCount(0);

  await hero.locator(".riv__head").click();
  await expect(hero.locator(".riv__detail")).toBeVisible();

  // A playoff meeting is named by its round, not reduced to a week number.
  await expect(hero.getByText("2025 · Semifinal · Dev by 22.8, 98.4-121.2")).toBeVisible();
  await expect(hero.getByText("2019 · Week 7 · Dev by 71.5, 62.1-133.6")).toBeVisible();
  await expect(hero.getByText("13 meetings, 2 in the playoffs, back to 2016")).toBeVisible();

  await hero.locator(".riv__head").click();
  await expect(hero.locator(".riv__detail")).toHaveCount(0);
});

test("the record survives the day moving", async ({ page }) => {
  await page.goto("/preview/matchups");
  const hero = page.locator(".sb[data-hero='true']");

  // The scores change all afternoon; nothing that happened in 2019 does.
  for (const stage of ["Nothing kicked", "One o'clock games on", "Monday night"]) {
    await page.getByRole("button", { name: stage, exact: true }).click();
    await expect(hero.locator(".riv__line")).toHaveText(/You are 4-8-1 against Dev/);
  }
});
