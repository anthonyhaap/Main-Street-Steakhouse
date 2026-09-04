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

test("the argument happens on the game it is about", async ({ page }) => {
  await page.goto("/preview/matchups");
  await page.getByRole("button", { name: "Late window", exact: true }).click();

  const hero = page.locator(".sb[data-hero='true']");

  // The closed line carries the count and the last thing said, so a quiet
  // thread and a loud one do not look the same.
  await expect(hero.locator(".sb__talk-n")).toHaveText("4");
  await expect(hero.locator(".sb__talk-teaser")).toContainText("Kicker's on bye");

  const messages = hero.locator(".talk__msg");
  await expect(messages).toHaveCount(4);
  await expect(messages.first()).toContainText("Starting Robinson over Gibbs is a choice.");

  // Who said it, and from which side of the game.
  await expect(messages.first()).toHaveAttribute("data-mine", "true");
  await expect(messages.nth(1)).toHaveAttribute("data-side", "away");
  // A third party heckling somebody else's table belongs to neither side.
  await expect(messages.nth(2)).not.toHaveAttribute("data-side", /home|away/);

  // A fixture has no session, so it gets the thread and no way to post.
  await expect(hero.locator(".talk__form")).toHaveCount(0);
});

test("a game nobody has talked about invites the first line", async ({ page }) => {
  await page.goto("/preview/matchups");
  await page.getByRole("button", { name: "Late window", exact: true }).click();

  const quiet = page.locator(".sb-list .sb").first();
  await expect(quiet.locator(".sb__talk-n")).toHaveCount(0);
  await expect(quiet.locator(".sb__talk-teaser")).toHaveText("Say something about this one");
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
