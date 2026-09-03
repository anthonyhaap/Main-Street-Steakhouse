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
