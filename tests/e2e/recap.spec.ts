import { expect, test } from "@playwright/test";

/**
 * The Weekly Special, as a page.
 *
 * The real one needs a session and a week the house has written up, so
 * /preview/recap is what a test can hold still. The assertions are the
 * sentences and what sits around them: the column exactly as composed, your
 * own line, the table, the wire, the bets, and the league's reaction.
 */

test("the Special is behind the session", async ({ page }) => {
  await page.goto("/recap");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/recap/3");
  await expect(page).toHaveURL(/\/login/);
});

test("the column is printed as the house composed it", async ({ page }) => {
  await page.goto("/preview/recap");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Weekly Special");
  await expect(page.getByText("The House · Week 10")).toBeVisible();
  const column = page.locator(".special");
  await expect(column).toContainText("Left on the pass: Priya sat Trey McBride (22.4) and lost by 5.1.");
  await expect(column).toHaveCSS("white-space", "pre-wrap");
});

test("your own line is on it, and only when you have a seat", async ({ page }) => {
  await page.goto("/preview/recap");
  await expect(page.getByRole("heading", { name: "You beat Mike by 13.5." })).toBeVisible();
  await expect(page.getByText("Up to 2nd. Two straight.")).toBeVisible();

  await page.getByRole("button", { name: "Signed out" }).click();
  await expect(page.getByRole("heading", { name: "You beat Mike by 13.5." })).toHaveCount(0);
});

test("the table that week sits under the column", async ({ page }) => {
  await page.goto("/preview/recap");
  await expect(page.getByRole("heading", { name: "Power rankings" })).toBeVisible();
  // Twelve teams, ranked as of that week.
  await expect(page.locator(".pwr__row")).toHaveCount(12);
});

test("the wire and the bets are counted, not listed", async ({ page }) => {
  await page.goto("/preview/recap");
  await expect(page.getByText("7 waiver claims")).toBeVisible();
  await expect(page.getByText("1 trades")).toBeVisible();
  const bets = page.getByRole("region", { name: "Settled at the table" });
  await expect(bets.getByText(/Dave.*won \$20 on higher week 10 score/)).toBeVisible();
  await expect(bets.getByText("Paid")).toBeVisible();
  await expect(bets.getByText("Owed")).toBeVisible();
});

test("the league's reaction is the first thing under the column", async ({ page }) => {
  await page.goto("/preview/recap");
  const fire = page.getByRole("button", { name: "🔥 4" });
  await expect(fire).toBeVisible();
  await fire.click();
  await expect(page.getByRole("button", { name: "🔥 5, including you" })).toBeVisible();
});

test("it can be sent to the chat, and moves between weeks", async ({ page }) => {
  await page.goto("/preview/recap");
  await page.getByRole("button", { name: "Share the Special" }).click();
  await expect(page.getByTestId("shared")).toBeVisible();
  await expect(page.getByRole("link", { name: "Wk 9" })).toHaveAttribute("href", "/recap/9");
});

test("it fits the phone", async ({ page }) => {
  await page.goto("/preview/recap");
  await expect(page.getByRole("heading", { name: "Power rankings" })).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});
