import { expect, test } from "@playwright/test";

/**
 * Steakhouse Sunday.
 *
 * The live page needs a session and an afternoon of real football, so the
 * fixture at /preview/sunday is what a test can hold still: one invented week
 * with a coherent NFL slate, and a switch that runs it from Sunday morning to
 * Tuesday. The assertions are the things the page exists to say — which game
 * to watch, who is in the red zone, which table is close — and that it keeps
 * saying them when the provider goes quiet.
 */

const stage = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();

test("the page changes personality across the day", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/sunday");
  const sun = page.locator(".sun");

  await stage(page, "Sunday morning");
  await expect(sun).toHaveAttribute("data-phase", "pre");
  await expect(page.locator(".sun-live")).toHaveText("Pre-game");
  await expect(page.locator(".sun-feat__label b")).toContainText("Game of the week");

  await stage(page, "One o'clock window");
  await expect(sun).toHaveAttribute("data-phase", "live");
  await expect(page.locator(".sun-live")).toHaveText("Live");
  await expect(page.locator(".sun-feat__label b")).toContainText("Game to watch");

  await stage(page, "Tuesday");
  await expect(sun).toHaveAttribute("data-phase", "final");
  await expect(page.getByRole("heading", { name: /Sunday at the Steakhouse/ }).first()).toBeVisible();
  await expect(page.locator(".sun-tile h3", { hasText: "Highest score" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the red zone names our players and the close game is lifted", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");

  // KC is inside the Denver nine; four of ours are Chiefs. The kicker is not
  // named — he scores from the thirty as happily as from the nine.
  const rz = page.locator(".sun-rz");
  await expect(rz.locator(".sun-rz__row")).toHaveCount(4);
  await expect(rz).toContainText("Patrick Mahomes");
  await expect(rz).not.toContainText("Harrison Butker");
  await expect(rz).toContainText("3rd & 4 at DEN 9");

  // Anthony and Marcus are inside five with the four o'clocks in the fourth.
  const close = page.locator("[data-panel='close']");
  if (await close.isHidden()) await page.getByRole("button", { name: /^Matchups/ }).last().click();
  await expect(close.locator(".sun-close__card")).toHaveCount(1);
  await expect(close).toContainText("Difference 3.30");

  // And it is the game to watch.
  await expect(page.locator(".sun-feat .sun-team__who").first()).toHaveText(/Anthony/i);
});

test("the win probability is written as well as drawn", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  const nums = page.locator(".sun-feat .sun-odds__nums span");
  await expect(nums).toHaveCount(2);
  for (const t of await nums.allTextContents()) expect(t).toMatch(/^(<1%|>99%|\d{1,3}%)$/);
  await expect(page.locator(".sun-feat .sun-odds__bar")).toHaveAttribute("aria-label", /%.*%/);
});

test("picking a table features it, and an NFL game shows our players in it", async ({ page }, info) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");

  if (info.project.name === "mobile") await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: /^Matchups/ }).click();
  await page.getByRole("button", { name: "Vic versus Sal" }).click();
  await expect(page.locator(".sun-feat__label b")).toHaveText("Your pick");
  await expect(page.locator(".sun-feat .sun-team__who").first()).toHaveText(/Vic/i);

  if (info.project.name === "mobile") await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: "NFL" }).click();
  await page.getByRole("button", { name: /^KC at DEN/ }).click();
  const game = page.locator(".sun-game[data-open='true']");
  await expect(game).toContainText("fantasy players involved");
  await expect(game.locator(".sun-game__p")).toHaveCount(10);
});

test("a quiet provider keeps the board and says so", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  await expect(page.locator(".sun-delay")).toHaveCount(0);
  await stage(page, "Provider down");
  await expect(page.locator(".sun-delay")).toContainText("Live stats temporarily delayed");
  await expect(page.locator(".sun-card")).toHaveCount(6);
});

test("the ticker runs and every line is a way in", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  const item = page.locator(".sun-ticker__item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(/CLOSE GAME|UPSET WATCH|RED ZONE/);
  await item.click();
  await expect(page.locator("#sun-featured")).toBeInViewport();
});

test("Watch NFL RedZone links out and embeds nothing", async ({ page }) => {
  await page.goto("/preview/sunday");
  const a = page.locator(".sun a[href*='nfl.com']").first();
  await expect(a).toHaveAttribute("target", "_blank");
  await expect(a).toHaveAttribute("rel", /noopener/);
  await expect(page.locator(".sun iframe, .sun video")).toHaveCount(0);
});
