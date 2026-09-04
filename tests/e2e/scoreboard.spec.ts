import { expect, test } from "@playwright/test";

/**
 * The Sunday board.
 *
 * The live page needs a session, a drafted league and an afternoon of real
 * football, so the fixture at /preview/matchups is what a test can hold still:
 * one invented week, and a switch that runs the clock from kickoff to Monday
 * night. The assertions are the sentences and the odds, because those are the
 * things the page exists to say.
 */

test("the board runs a Sunday forward", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/matchups");

  const hero = page.locator(".sb[data-hero='true']");
  await expect(hero).toHaveCount(1);
  await expect(hero).toHaveAttribute("data-mine", "true");

  // Nothing kicked: the projection is the number, and no odds are claimed
  // beyond what the projections say.
  await page.getByRole("button", { name: "Nothing kicked", exact: true }).click();
  await expect(hero.getByText("Projected to win")).toBeVisible();
  await expect(hero.locator(".sb__proj").first()).toHaveText("projected");

  // One o'clock: football is on, and the card says how much.
  await page.getByRole("button", { name: "One o'clock games on", exact: true }).click();
  await expect(hero.getByText(/Live · \d+ players in action/i)).toBeVisible();
  await expect(hero.getByText("Win probability")).toBeVisible();

  // Monday night: one man against an empty bench, named, with a number.
  await page.getByRole("button", { name: "Monday night", exact: true }).click();
  await expect(hero.locator(".sb__line")).toHaveText(/You need [\d.]+ from \w+\. He's projected [\d.]+\./);

  expect(errors).toEqual([]);
});

test("the odds are stated in text, not only in colour", async ({ page }) => {
  await page.goto("/preview/matchups");
  const nums = page.locator(".sb[data-hero='true'] .sb__odds-nums span");
  await expect(nums).toHaveCount(2);
  for (const text of await nums.allTextContents()) {
    expect(text).toMatch(/^(<1%|>99%|\d{1,3}%)$/);
  }
  // And the bar carries the same split for a screen reader.
  await expect(page.locator(".sb[data-hero='true'] .sb__bar")).toHaveAttribute(
    "aria-label", /%.*%/,
  );
});

test("both lineups open with a game state on every row", async ({ page }) => {
  await page.goto("/preview/matchups");
  await page.getByRole("button", { name: "Late window", exact: true }).click();

  const hero = page.locator(".sb[data-hero='true']");
  await hero.getByRole("button", { name: /Both lineups/ }).click();

  const rows = hero.locator(".sb__plr");
  await expect(rows).toHaveCount(18);
  await expect(rows.first().locator(".sb__mark")).toBeVisible();
});

test("the numbers say when they were written", async ({ page }) => {
  await page.goto("/preview/matchups");
  await expect(page.getByText(/Scores .*(ago|not yet scored)/)).toBeVisible();
});

test("playoff odds are withheld until the draft", async ({ page }) => {
  await page.goto("/preview/standings");

  await page.getByRole("button", { name: "Before the draft" }).click();
  await expect(page.getByText(/Playoff odds unlock after the draft/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Playoffs" })).toHaveCount(0);
  await expect(page.getByText("Listed alphabetically · no seeding until week one")).toBeVisible();

  // Mid-season, the same board publishes them.
  await page.getByRole("button", { name: "Week 11" }).click();
  await expect(page.getByRole("columnheader", { name: "Playoffs" })).toBeVisible();
  await expect(page.getByText(/simulated seasons/)).toBeVisible();
});
