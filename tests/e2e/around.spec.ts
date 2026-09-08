import { expect, test } from "@playwright/test";

/**
 * Around the house — the whole league at four o'clock.
 *
 * The fixture at /preview/matchups runs a Sunday forward, so the states this
 * screen has to be right in are all reachable: nothing kicked, a window on,
 * and the afternoon over. What is asserted is mostly agreement — between the
 * sentence at the top and the list under it, and between this screen and the
 * board it summarises — because those are computed by different routes and a
 * disagreement is the bug a reader would actually notice.
 */

const open = async (page: import("@playwright/test").Page, stage?: string) => {
  await page.goto("/preview/matchups");
  if (stage) await page.getByRole("button", { name: stage, exact: true }).click();
  await page.getByRole("button", { name: "Around the house" }).click();
};

/** The live list only — `.hl__row` is also used by the swings section. */
const liveRows = (page: import("@playwright/test").Page) =>
  page.locator("section:has(h2:text-is('On the field')) .hl__row");

test("the sentence at the top and the list under it agree", async ({ page }) => {
  await open(page);

  // The headline counts `in_action`, which ff_scoreboard totals per side; the
  // list filters starters on game_status. Two routes to the same number, so
  // they are checked against each other rather than against a constant.
  const line = await page.locator(".house-live__line").innerText();
  const claimed = Number(line.match(/^(\d+) players? on the field/)?.[1]);
  expect(Number.isFinite(claimed)).toBe(true);
  await expect(liveRows(page)).toHaveCount(claimed);
});

test("the field is ranked, best first", async ({ page }) => {
  await open(page);

  const points = await liveRows(page).locator(".hl__num b").allInnerTexts();
  const nums = points.map(Number);
  expect(nums.length).toBeGreaterThan(1);
  expect(nums).toEqual([...nums].sort((a, b) => b - a));
});

test("every man on the field says whose afternoon he is deciding", async ({ page }) => {
  await open(page);

  // A list of good performances is a stat sheet. The owner is what makes it
  // worth looking at.
  for (const row of await liveRows(page).all()) {
    await expect(row.locator(".hl__sub span").first()).not.toHaveText("");
  }
  // And your own men are marked rather than hunted for.
  await expect(page.locator('section:has(h2:text-is("On the field")) .hl__row[data-mine="true"]').first())
    .toBeVisible();
});

test("close games are the ones still going, closest first", async ({ page }) => {
  await open(page);

  const gaps = await page.locator(".hl-close__gap").allInnerTexts();
  const margins = gaps.map((g) => (g === "level" ? 0 : Number(g.replace(" in it", ""))));
  expect(margins.length).toBeGreaterThan(0);
  expect(margins).toEqual([...margins].sort((a, b) => a - b));
  // Nothing over the threshold gets in.
  for (const m of margins) expect(m).toBeLessThanOrEqual(20);
});

test("a bust is only called after the whistle", async ({ page }) => {
  await open(page);

  // A man on nine at half time has not missed his projection, he is halfway
  // through it — so the swings list is finished games only, and says so.
  await expect(page.getByText(/a man on nine at half time has not busted/)).toBeVisible();

  const swung = page.locator("section:has(h2:text-is('Days made and ruined')) .hl__row");
  for (const row of await swung.all()) {
    await expect(row.locator(".hl__sub")).toContainText("Final");
  }
});

test("before anybody kicks it says so instead of showing an empty list", async ({ page }) => {
  await open(page, "Nothing kicked");

  await expect(page.locator(".house-live__line")).toContainText("Nobody is on the field");
  await expect(page.locator(".house-live__line")).toContainText("still to kick off");
  await expect(page.getByText("Nobody is playing right now.")).toBeVisible();
  await expect(liveRows(page)).toHaveCount(0);
});

test("the board is still one tap away", async ({ page }) => {
  await open(page);
  await expect(page.locator(".sb")).toHaveCount(0);

  await page.getByRole("button", { name: "The board" }).click();
  await expect(page.locator(".sb").first()).toBeVisible();
  await expect(page.locator(".house-live")).toHaveCount(0);
});
