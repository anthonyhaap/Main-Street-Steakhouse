import { expect, test } from "@playwright/test";

/**
 * The playoff race: what this week is worth, from the same simulated seasons
 * as the standings table. /preview/standings is the fixture league through
 * week ten, and its seat switch decides whose race the card tells.
 */

const race = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "The race" });

test("a team on the bubble is told what Sunday does to it, and whose games to watch", async ({ page }) => {
  await page.goto("/preview/standings");
  await page.getByRole("group", { name: "Your seat" }).getByRole("button", { name: "Bubble" }).click();
  const card = race(page);
  await expect(card).toContainText("Week 11 · what it is worth");
  await expect(card).toContainText("You are at 11%. Beat Tomahawk Chop: 19%. Lose: 3%.");
  await expect(card).toContainText("Also root for Sirloin Syndicate over Wagyu Warriors");
  // Four games left, and even all four is not a lock.
  await expect(card).toContainText("Even winning all four gets you in 87% of the time — you need help.");
  const path = card.getByRole("list", { name: "Your odds by how many more games you win" });
  await expect(path).toContainText("4 more87%");
  // It starts at the first count that gives a chance, not a row of "<1%".
  await expect(path.locator("li").first()).toContainText("2 more5%");
});

test("a long shot is not told what the simulation never looked at", async ({ page }) => {
  await page.goto("/preview/standings");
  await page.getByRole("group", { name: "Your seat" }).getByRole("button", { name: "Long shot" }).click();
  // 2–8 with four left: winning all four came up in too few seasons to call.
  const card = race(page);
  await expect(card).toContainText("In the seasons where you win three more, you get in <1%.");
  await expect(card).toContainText("Winning all four came up too rarely in the simulation to say.");
  await expect(card).not.toContainText("Even winning all four");
});

test("the race and the table are the same seasons", async ({ page }) => {
  await page.goto("/preview/standings");
  await page.getByRole("group", { name: "Your seat" }).getByRole("button", { name: "Bubble" }).click();
  const row = page.locator("table.stand tr", { hasText: "Filet Force" });
  const odds = (await row.locator(".stand__pct").first().textContent())?.trim();
  expect(odds).toMatch(/^\d+%$/);
  await expect(race(page)).toContainText(`You are at ${odds}.`);
});

test("a settled seat is told so, and nobody's race is told to a visitor", async ({ page }) => {
  await page.goto("/preview/standings");
  const seats = page.getByRole("group", { name: "Your seat" });
  await seats.getByRole("button", { name: "Out", exact: true }).click();
  await expect(race(page)).toContainText("You are out of the running.");
  await expect(race(page)).not.toContainText("Beat ");

  await seats.getByRole("button", { name: "Signed out" }).click();
  await expect(race(page)).not.toContainText("You are");
  // The games that matter are everybody's, and each opens its matchup.
  const games = race(page).locator(".race__game");
  await expect(games.first()).toHaveAttribute("href", /^\/matchups\/m11-\d\?week=11$/);
  await expect(games.first()).toContainText(" win · ");
  // A side the game cannot move says so, rather than "<1% win · <1% loss".
  await expect(race(page).locator(".race__game", { hasText: "Sirloin Syndicate at" })).toContainText("Sirloin Syndicate no chance either way");
});

test("the front page carries the race in a line while it is one", async ({ page }) => {
  await page.goto("/preview/tonight");
  await expect(page.getByRole("region", { name: "Your playoff race" })).toHaveCount(0);
  await page.getByRole("group", { name: "Playoff race" }).getByRole("button", { name: "On the bubble" }).click();
  const line = page.getByRole("region", { name: "Your playoff race" });
  await expect(line).toContainText("11% now. A win this week: 19%. A loss: 3%.");
  await expect(line).toContainText("Also root for Sirloin Syndicate over Wagyu Warriors.");
  await expect(line.getByRole("link", { name: "The whole race" })).toHaveAttribute("href", "/standings");
});
