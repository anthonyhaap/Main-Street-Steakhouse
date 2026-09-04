import { expect, test } from "@playwright/test";

/**
 * Tonight's Table and the rooms around it.
 *
 * The real screen needs a session and a live week, so the fixture at
 * /preview/tonight is what a test can hold still: one invented league, and a
 * switch that moves the clock through the week. The assertions are the
 * sentences, because the sentences are the product.
 */

test("the first screen is behind the session", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("the card changes personality by day", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/tonight");

  // Thursday: the book, and the lineup nag.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You vs. Dave");
  await expect(page.getByText("You've dropped three straight to Dave. Sunday's the rematch.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Check on Nacua/ })).toBeVisible();

  // Tuesday: the result.
  await page.getByRole("button", { name: "Tuesday" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You beat Mike.");
  await expect(page.getByText(/You took it by 13\.5\. Second straight win\./)).toBeVisible();
  await expect(page.getByRole("button", { name: /Send the recap/ })).toBeVisible();

  // Wednesday: waivers.
  await page.getByRole("button", { name: "Wednesday" }).click();
  await expect(page.getByRole("link", { name: /waiver wire/ })).toBeVisible();

  // Sunday: live, with players left on both sides.
  await page.getByRole("button", { name: "Sunday live" }).click();
  await expect(page.getByText(/Week 3 · Live/)).toBeVisible();
  await expect(page.getByText(/players left; Dave has/)).toBeVisible();
  await expect(page.getByText("Still to play")).toBeVisible();

  // Monday: one man, one number.
  await page.getByRole("button", { name: "Monday night" }).click();
  await expect(page.getByText(/You need 11\.4 from McBride\. He's projected 12\.4\./)).toBeVisible();

  // Draft night.
  await page.getByRole("button", { name: "Draft night" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're on the clock.");
  await expect(page.getByRole("link", { name: "Make your pick" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the six tables swipe, yours first", async ({ page }) => {
  await page.goto("/preview/tonight");
  const tables = page.locator(".carousel .table");
  await expect(tables).toHaveCount(6);
  await expect(tables.first()).toHaveAttribute("data-mine", "true");
});

test("the clubhouse is on the front page, with what it was said about", async ({ page }) => {
  await page.goto("/preview/tonight");
  const club = page.locator(".club");

  // Not "the room" — that is the carousel one section up.
  await expect(club.getByText("Overheard")).toBeVisible();
  await expect(club.locator(".club__lines li")).toHaveCount(5);

  // Your own table's thread, with the last line in it, one tap from the board.
  const mine = club.locator(".club__mine");
  await expect(mine).toContainText("3 about your table");
  await expect(mine).toContainText("Nacua's a game-time call");
  await expect(mine).toHaveAttribute("href", "/matchups?week=3");

  // A line said on a matchup carries the game, and says so from your side.
  await expect(club.getByRole("link", { name: /on your game · week 3/ })).toBeVisible();
  await expect(club.getByRole("link", { name: /on Wagyu Warriors vs Prime Cut · week 2/ }))
    .toHaveAttribute("href", "/matchups?week=2");

  // A line said in the room carries nothing.
  const roomLine = club.locator(".club__lines li", { hasText: "Whoever has Kraft" });
  await expect(roomLine.locator(".club__on")).toHaveCount(0);

  await expect(club.getByText("14 lines this week.")).toBeVisible();
});

test("the house writes the week up, and it reads as a column", async ({ page }) => {
  await page.goto("/preview/tonight");
  const house = page.locator('.club__lines li[data-kind="house"]');

  await expect(house).toHaveCount(1);
  await expect(house.locator(".club__said b")).toHaveText("The House");
  await expect(house).toContainText("The Weekly Special · Week 2");

  // The card, then the notes. Every line ff_recap_body composes.
  await expect(house).toContainText("Tom 130.1 — Nate 83.9");
  await expect(house).toContainText("Tonight's Specials: Dave, 142.6.");
  await expect(house).toContainText("The Bill: Tom by 46.2 over Nate.");
  await expect(house).toContainText("Last Call: Sam edged Kai by 0.8.");
  await expect(house).toContainText("Left on the pass: Priya sat Trey McBride (22.4) and lost by 5.1.");
  await expect(house).toContainText("Player of the week: Puka Nacua (LAR), 34.2, for Dave.");

  // Written by the league, so it is nobody's line and carries no matchup.
  await expect(house).toHaveAttribute("data-mine", "false");
  await expect(house.locator(".club__on")).toHaveCount(0);

  // The line breaks it was composed with survive to the screen.
  await expect(house.locator("p")).toHaveCSS("white-space", "pre-wrap");
});

test("the primary nav fits the header it is in", async ({ page }, testInfo) => {
  await page.goto("/preview/tonight");
  const width = page.viewportSize()!.width;
  const shown = await page.locator(".nav").evaluate((el) => getComputedStyle(el).display !== "none");

  // Eleven destinations and a wordmark do not fit a small laptop; below the
  // breakpoint the tab bar and its More menu carry them instead.
  expect(shown).toBe(width > 1180);
  const doc = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(doc, `${testInfo.project.name} at ${width}px scrolls sideways`).toBeLessThanOrEqual(width);
});

test("the history wall hangs the plaques", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/history");
  await expect(page.getByRole("heading", { name: "Champions" })).toBeVisible();
  await expect(page.locator(".plaque__year")).toHaveCount(11);
  await expect(page.getByRole("heading", { name: "Head to head, all time" })).toBeVisible();
  await expect(page.locator(".h2h__cell")).toHaveCount(144);
  await expect(page.locator(".mgrcard")).toHaveCount(12);
  expect(errors).toEqual([]);
});

test("a share link opens without a session and refuses junk", async ({ page, request }) => {
  const junk = await request.get("/share/matchup/not-a-matchup");
  expect(junk.status()).toBe(404);

  // The public surface never bounces to the login page.
  await page.goto("/share/matchup/00000000-0000-0000-0000-000000000000");
  await expect(page).not.toHaveURL(/\/login/);
});

test("the phone gets a manifest and a launch screen", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const json = await manifest.json();
  expect(json.display).toBe("standalone");
  expect(json.background_color).toBe("#191614");

  const splash = await request.get("/splash/1170x2532.png");
  expect(splash.ok()).toBeTruthy();
  expect(splash.headers()["content-type"]).toContain("image/png");

  const bad = await request.get("/splash/evil.png");
  expect(bad.status()).toBe(404);
});
