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

/**
 * The room reads down, like every chat on a phone: the newest line at the
 * bottom, right over the composer, and the page opens there. A line you send
 * lands at the bottom and stays in view.
 */
test("the room opens on the newest line, over the composer", async ({ page }) => {
  await page.goto("/preview/chat");
  const rows = page.locator(".chat-log .row");
  await expect(rows.last()).toContainText("that trade is a robbery and you all know it");
  await expect(rows.last()).toBeInViewport();

  const box = page.getByRole("textbox", { name: "Say something to the league" });
  await box.fill("pay up, Bo");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(rows.last()).toContainText("pay up, Bo");
  await expect(rows.last()).toBeInViewport();
  await expect(box).toHaveValue("");

  // The composer never covers the line it just sent — once the smooth
  // scroll that brings it into view has finished.
  await expect.poll(async () => {
    const last = (await rows.last().boundingBox())!;
    const composer = (await page.locator(".chat-compose").boundingBox())!;
    return last.y + last.height - composer.y;
  }).toBeLessThanOrEqual(1);
});

test("asking the room opens a sheet, not a form at the top of the page", async ({ page }) => {
  await page.goto("/preview/chat");
  await page.getByRole("button", { name: "Ask the room a question" }).click();
  const sheet = page.getByRole("dialog", { name: "Ask the room" });
  await expect(sheet.getByRole("textbox", { name: "Your question" })).toBeFocused();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);
});

/**
 * On a phone, typing puts the tab bar away: it would otherwise ride the
 * keyboard or hide behind it, and the composer sits on the keyboard instead.
 */
test("the tab bar steps aside for the keyboard", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "a phone's keyboard");
  await page.goto("/preview/chat");
  const bar = page.locator(".tabbar");
  await expect(bar).toBeVisible();
  await page.getByRole("textbox", { name: "Say something to the league" }).tap();
  await expect(bar).toBeHidden();
  await page.locator(".chat-log .row").first().tap();
  await expect(bar).toBeVisible();
});
