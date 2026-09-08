import { expect, test } from "@playwright/test";

/**
 * The draft, on the television.
 *
 * The screen exists to be read from a sofa by somebody holding a drink, so
 * what is asserted here is what is legible and what is absent: the clock, the
 * pick that just went and whether the room should care about it, and no
 * controls to fiddle with.
 */

test("the television is behind the session", async ({ page }) => {
  await page.goto("/draft/tv");
  await expect(page).toHaveURL(/\/login/);
});

test("the clock is the biggest thing in the room", async ({ page }) => {
  await page.goto("/preview/draft-tv");

  await expect(page.locator(".tv__label").first()).toHaveText("On the clock");
  await expect(page.locator(".tv__team")).toHaveText("Tomahawk Chop");
  await expect(page.locator(".tv__mgr")).toHaveText("Jules");
  await expect(page.locator(".tv__time")).toHaveText("1:03");

  // Where the room is, without anybody having to count.
  await expect(page.locator(".tv__where")).toHaveText("Round 3 · Pick 31 of 180");
});

test("a steal is called a steal, and says by how much", async ({ page }) => {
  await page.goto("/preview/draft-tv");

  await expect(page.getByText("Just picked · 3.06")).toBeVisible();
  await expect(page.locator(".tv__player")).toHaveText("Aaron Jones");

  const grade = page.locator(".tv__grade");
  await expect(grade).toContainText("Steal");
  await expect(grade).toHaveAttribute("data-tone", "ok");
  // The number is the argument. "Steal" on its own is an opinion.
  await expect(grade).toContainText("26 picks later than the market");
});

test("the last fifteen seconds look like the last fifteen seconds", async ({ page }) => {
  await page.goto("/preview/draft-tv");

  await expect(page.locator(".tv")).toHaveAttribute("data-urgent", "false");
  await page.getByRole("button", { name: "Fifteen seconds left" }).click();
  await expect(page.locator(".tv")).toHaveAttribute("data-urgent", "true");
  await expect(page.locator(".tv__time")).toHaveText("0:09");
});

test("a paused draft says so rather than showing a stopped clock", async ({ page }) => {
  await page.goto("/preview/draft-tv");
  await page.getByRole("button", { name: "Paused" }).click();

  // A frozen number reads as a bug. The word does not.
  await expect(page.locator(".tv__time")).toHaveText("PAUSED");
});

test("before the first pick nobody is on the clock", async ({ page }) => {
  await page.goto("/preview/draft-tv");
  await page.getByRole("button", { name: "Before the first pick" }).click();

  // Naming somebody over a stopped clock is the screen lying about the one
  // thing it exists for.
  await expect(page.locator(".tv__team")).toHaveText("Waiting for the commissioner.");
  await expect(page.locator(".tv__player")).toHaveText("The board is clean.");
  await expect(page.locator(".tv__grade")).toHaveCount(0);
});

test("the finished board stops pretending there is a pick coming", async ({ page }) => {
  await page.goto("/preview/draft-tv");
  await page.getByRole("button", { name: "The board is full" }).click();

  await expect(page.locator(".tv")).toHaveAttribute("data-done", "true");
  await expect(page.locator(".tv__team")).toHaveText("Every seat is full.");
  await expect(page.locator(".tv__time")).toHaveCount(0);
});

test("what is coming is on screen without anybody asking", async ({ page }) => {
  await page.goto("/preview/draft-tv");

  const next = page.locator(".tv__next li");
  await expect(next).toHaveCount(4);
  await expect(next.first()).toContainText("3.08");
  await expect(next.first()).toContainText("Filet Force");

  // And the five before the one that just went, newest first.
  const recent = page.locator(".tv__recent li");
  await expect(recent).toHaveCount(5);
  await expect(recent.first()).toContainText("3.05");
  await expect(recent.last()).toContainText("3.01");
});

test("there is nothing on it to press", async ({ page }) => {
  await page.goto("/preview/draft-tv");

  // Everything on this screen updates itself. The only control anywhere near
  // it is the fixture's own stage switch, which the real page does not have.
  const inside = page.locator(".tv button");
  await expect(inside).toHaveCount(0);
});

test("what the room said reaches the wall", async ({ page }) => {
  await page.goto("/preview/draft-tv");

  // Pressed on eleven phones, displayed on the television — which is the only
  // reason to put a reaction on a screen nobody can touch.
  const reacts = page.locator(".tv__reacts");
  await expect(reacts).toBeVisible();
  await expect(reacts.locator(".tv__react")).toHaveCount(2);
  await expect(reacts).toContainText("🔥");
  await expect(reacts).toContainText("7");

  // And still nothing to press.
  await expect(page.locator(".tv button")).toHaveCount(0);
});

test("a pick nobody reacted to shows no empty tray", async ({ page }) => {
  await page.goto("/preview/draft-tv");
  await page.getByRole("button", { name: "Paused" }).click();
  await expect(page.locator(".tv__reacts")).toHaveCount(0);
});
