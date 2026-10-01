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

  // The close game is lifted; the featured slot, though, belongs for a few
  // minutes to the Steakhouse moment — Lou retaking the lead late.
  await expect(page.locator(".sun-feat__label b")).toContainText("Steakhouse moment");
  await expect(page.locator(".sun-feat .sun-score")).toContainText(/Lou/i);
  await expect(page.locator(".sun-feat .sun-score")).toContainText(/Gus/i);
});

test("a touchdown says who it helped, by how much, and what it did to the game", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");

  const td = page.locator(".sun-event[data-kind='touchdown']", { hasText: "Puka Nacua" });
  await expect(td).toBeVisible();
  await expect(td).toContainText("40+ yard receiving touchdown");
  await expect(td.locator(".sun-event__pts")).toHaveText("+9.1 Marcus");
  const impact = td.locator(".sun-impact");
  await expect(impact).toContainText("Fantasy impact");
  // Before and after, leader first on each line.
  await expect(impact.locator(".sun-impact__row").nth(0)).toContainText(/Before\s*Anthony 130\.6\s*Marcus 118\.2/);
  await expect(impact.locator(".sun-impact__row").nth(1)).toContainText(/After\s*Anthony 130\.6\s*Marcus 127\.3/);

  // The Steakhouse moment carries its level, so it is the loudest card.
  await expect(page.locator(".sun-event[data-level='4']")).toContainText("Lou takes the lead over Gus");
});

test("the feed keeps the quiet plays behind a switch, and keeps the day after it ends", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "One o'clock window");
  const feed = page.locator(".sun-evfeed");
  await expect(feed.locator(".sun-event[data-level='1']")).toHaveCount(0);
  await feed.getByRole("button", { name: /Everything/ }).click();
  await expect(feed.locator(".sun-event[data-level='1']")).toContainText("Ja'Marr Chase");
  // No moment in the early window: the featured slot is the ranked game.
  await expect(page.locator(".sun-feat__label b")).toContainText("Game to watch");

  // Tuesday: every final is there, and so is Sunday afternoon.
  await stage(page, "Tuesday");
  await expect(page.locator(".sun-evfeed .sun-event[data-kind='touchdown']", { hasText: "Puka Nacua" })).toBeVisible();
  await expect(page.locator(".sun-evfeed .sun-event[data-kind='final']", { hasText: "Vic beats Sal" })).toBeVisible();
});

test("a feed card opens its matchup", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  await page.locator(".sun-event[data-kind='touchdown']", { hasText: "Puka Nacua" })
    .getByRole("button", { name: "View matchup" }).click();
  await expect(page.locator(".sun-feat__label b")).toHaveText("Your pick");
  await expect(page.locator(".sun-feat .sun-team__who").nth(1)).toHaveText(/Marcus/i);
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

test("the game center is one tap from any screen", async ({ page }, info) => {
  await page.goto("/preview/tonight");
  const pill = page.locator(".gc-pill");
  if (info.project.name === "mobile") {
    // A phone: the button in the top bar, on every page, never behind More.
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("href", "/sunday");
    const box = (await pill.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(34);
  } else {
    // A laptop: the nav has no room for it, so it is in the League menu.
    await expect(pill).toBeHidden();
    await page.getByRole("button", { name: "League" }).click();
    await expect(page.getByRole("link", { name: "Game Center" })).toHaveAttribute("href", "/sunday");
  }
});

test("on a desktop the chat takes a column and covers nothing", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "the phone has its own chat tab");
  const apart = (a: { x: number; width: number }, b: { x: number; width: number }) =>
    a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1;
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/preview/sunday");
    await page.locator(".sun-tabs[data-for='desk']").getByRole("button", { name: "Chat" }).click();
    const chat = (await page.locator(".sun-drawer").boundingBox())!;
    const main = (await page.locator(".sun-main").boundingBox())!;
    expect(apart(chat, main), `${width}: chat over the board`).toBe(true);
    const rail = page.locator(".sun-rail");
    if (await rail.isVisible()) expect(apart(chat, (await rail.boundingBox())!), `${width}: chat over the rail`).toBe(true);
    // And the featured panel stays inside its own column.
    const feat = (await page.locator(".sun-feat").boundingBox())!;
    expect(feat.x + feat.width).toBeLessThanOrEqual(main.x + main.width + 1);
  }
});
