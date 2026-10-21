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

test("how it happened: the week as the events stored it, not just the finals", async ({ page }) => {
  await page.goto("/preview/recap");
  const how = page.getByRole("region", { name: "How it happened" });
  await expect(how.getByText("5 lead changes")).toBeVisible();
  // Your own table first, marked.
  const games = how.locator(".recap__games > li");
  await expect(games.first()).toContainText("Dev beats Ray, 92.20–81.50");
  await expect(games.first()).toContainText("Your game");
  // The change that stood is the winner's last one, with its time.
  await expect(how.locator("li", { hasText: "Gus beats Lou" }))
    .toContainText("The lead changed hands twice · for good: Gus passes Lou, Mon 9:34 PM ET.");
  // A lead the loser took is counted, never told as the one that decided it.
  const moe = how.locator("li", { hasText: "Moe beats Hank" });
  await expect(moe).toContainText("The lead changed hands once.");
  await expect(moe).not.toContainText("for good");
  // The detector's own words for the upset.
  await expect(how.locator("li", { hasText: "Vic beats Sal" })).toContainText("The upset: came in projected 10.6 behind.");
  // The comeback is a moment, and not a second lead change.
  await expect(how.locator(".recap__moments")).toContainText("Marcus comes back on Anthony");
  await expect(how.locator(".recap__moments")).toContainText("Was down 38.4 and now leads");
  await expect(how.locator("li", { hasText: "Marcus beats Anthony" })).toContainText("changed hands once");
  await expect(how.getByRole("link", { name: /The whole day in the Game Center/ })).toHaveAttribute("href", "/sunday?week=10");
  await expect(how.getByRole("link", { name: /Gus beats Lou/ })).toHaveAttribute("href", "/matchups/gm5?week=10");
});

test("a week from before the feed tells no story at all", async ({ page }) => {
  await page.goto("/preview/recap");
  await page.getByRole("button", { name: "Before the feed" }).click();
  await expect(page.getByRole("region", { name: "How it happened" })).toHaveCount(0);
  await expect(page.locator(".special")).toBeVisible();
});

test("signed out, no table is called yours", async ({ page }) => {
  await page.goto("/preview/recap");
  await page.getByRole("button", { name: "Signed out" }).click();
  await expect(page.getByRole("region", { name: "How it happened" }).getByText("Your game")).toHaveCount(0);
});
