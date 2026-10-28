import { expect, test } from "@playwright/test";

test("Chat is behind the session", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login/);
});

test("a reply carries what it answers", async ({ page }) => {
  await page.goto("/preview/chat");
  await expect(page.getByText("that trade is a robbery and you all know it", { exact: true })).toBeVisible();
  await expect(page.getByText("you're just mad you didn't think of it first")).toBeVisible();
  await expect(page.getByText(/Bo: that trade is a robbery and you all know it/)).toBeVisible();
});

test("a mention shows who was tagged", async ({ page }) => {
  await page.goto("/preview/chat");
  await expect(page.getByText("anyone else still missing a kicker")).toBeVisible();
  await expect(page.getByText("@Bo")).toBeVisible();
});

test("a matchup line says which game it was said about", async ({ page }) => {
  await page.goto("/preview/chat");
  await expect(page.getByRole("link", { name: /Week 3 · Gridiron Butchers vs Prime Cut/ })).toBeVisible();
});

test("an empty Chat explains what will fill it", async ({ page }) => {
  await page.goto("/preview/chat");
  await page.getByRole("button", { name: "Quiet" }).click();
  await expect(page.getByText(/Say something to the league, or ask it a question/)).toBeVisible();
});

test("a reaction is a toggle, and says who is in the count", async ({ page }) => {
  await page.goto("/preview/chat");

  const skull = page.getByRole("button", { name: /^💀 3, including you$/ });
  await expect(skull).toBeVisible();
  await expect(skull).toHaveAttribute("aria-pressed", "true");

  await skull.click();
  await expect(page.getByRole("button", { name: /^💀 2$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^💀 2$/ })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: /^💀 2$/ }).click();
  await expect(page.getByRole("button", { name: /^💀 3, including you$/ })).toBeVisible();
});

test("a line nobody has reacted to offers one quiet button, not a palette", async ({ page }) => {
  await page.goto("/preview/chat");

  const adders = page.getByRole("button", { name: "Add a reaction" });
  await expect(adders.first()).toBeVisible();

  await adders.first().click();
  await expect(page.getByRole("button", { name: "React with 😂" })).toBeVisible();

  await page.getByRole("button", { name: "React with 😂" }).click();
  await expect(page.getByRole("button", { name: /^😂 1, including you$/ })).toBeVisible();
});

test("a poll withholds its split until you answer", async ({ page }) => {
  await page.goto("/preview/chat");

  await expect(page.getByText("Who wins the Chase trade?")).toBeVisible();
  await expect(page.getByText(/7 votes · answer to see the split/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Vote for Chuck Wagon, easily" })).toBeVisible();

  await page.getByRole("button", { name: "Vote for Chuck Wagon, easily" }).click();
  await expect(page.getByRole("button", { name: /Chuck Wagon, easily, 1 of 8, your answer/ })).toBeVisible();
  await expect(page.getByText(/8 votes/)).toBeVisible();
  await expect(page.getByText(/answer to see the split/)).toHaveCount(0);
});

test("a poll already answered shows the split straight away", async ({ page }) => {
  await page.goto("/preview/chat");
  await expect(page.getByText("Move the draft to Thursday?")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Yes, 6 of 9, your answer$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^No, Sunday or nothing, 3 of 9$/ })).toBeVisible();
});
