import { expect, test } from "@playwright/test";

/**
 * The trade desk.
 *
 * The real screen needs a session, a drafted league and a second manager
 * willing to negotiate, so /preview/trades is what a test can hold still. The
 * assertions are the affordances, because who may press what is the whole
 * difference between an offer and a rumour.
 */

test("the desk is behind the session", async ({ page }) => {
  await page.goto("/trades");
  await expect(page).toHaveURL(/\/login/);
});

test("an offer reads from your side of the table", async ({ page }) => {
  await page.goto("/preview/trades");
  await expect(page.getByText("Prime Cut offered you")).toBeVisible();
  // Rome Odunze is theirs, so from this side he is arriving, not leaving.
  const incoming = page.locator(".card", { hasText: "Prime Cut offered you" });
  await expect(incoming.getByText("You give")).toBeVisible();
  await expect(incoming.getByText("You get")).toBeVisible();
});

test("only the receiving side is offered accept and counter", async ({ page }) => {
  await page.goto("/preview/trades");
  const theirs = page.locator(".card", { hasText: "Prime Cut offered you" });
  await expect(theirs.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(theirs.getByRole("button", { name: "Counter" })).toBeVisible();
  await expect(theirs.getByRole("button", { name: "Decline" })).toBeVisible();

  // Your own offer can only be withdrawn — you cannot accept yourself.
  const mine = page.locator(".card", { hasText: "you offered Filet Force" });
  await expect(mine.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expect(mine.getByRole("button", { name: "Accept" })).toHaveCount(0);
});

test("the deadline closes the desk and says so", async ({ page }) => {
  await page.goto("/preview/trades");
  await expect(page.getByRole("button", { name: "Make an offer" })).toBeEnabled();

  await page.getByRole("button", { name: "Deadline gone" }).click();
  await expect(page.getByText(/Nothing more moves this season/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Make an offer" })).toBeDisabled();
});

test("the block says listing promises nothing", async ({ page }) => {
  await page.goto("/preview/trades");
  await expect(page.getByText("Zay Flowers")).toBeVisible();
  await expect(page.getByText(/want a back/)).toBeVisible();
  await expect(page.getByRole("button", { name: "List yours" })).toBeVisible();
});

test("every name on the desk reads with who he plays this week", async ({ page }) => {
  await page.goto("/preview/trades");
  const incoming = page.locator(".card", { hasText: "Prime Cut offered you" });
  // Odunze's Bears are away at Miami; Wright's Dolphins host them.
  await expect(incoming.getByText("Rome Odunze").locator("..")).toContainText("@");
  await expect(incoming.getByText("Rome Odunze").locator("..")).toContainText("MIA");
  await expect(incoming.getByText("Jaylen Wright").locator("..")).toContainText("vs");
  // Tennessee is on its bye in the fixture, so Spears says so on the block.
  const block = page.locator(".card", { hasText: "The block" });
  await expect(block.locator(".row", { hasText: "Tyjae Spears" })).toContainText("Bye");
  await expect(block.locator(".row", { hasText: "Zay Flowers" })).toContainText("PIT");
});

test("the deadline week counts down on the desk, on the league's clock", async ({ page }) => {
  await page.goto("/preview/trades");
  // Five weeks out it is a week number, and nothing more.
  await expect(page.getByText("deadline: week 12")).toBeVisible();
  await expect(page.getByText(/Trades close/)).toHaveCount(0);

  await page.getByRole("button", { name: "Deadline week" }).click();
  await expect(page.getByText("deadline in 3 days")).toBeVisible();
  await expect(page.getByText(/Trades close Tue 12:15 AM ET, after Monday night's game\. Anything still on the table then expires\./))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Make an offer" })).toBeEnabled();

  await page.getByRole("button", { name: "Last day" }).click();
  await expect(page.getByText("deadline in 5 hours")).toBeVisible();

  await page.getByRole("button", { name: "Deadline gone" }).click();
  await expect(page.getByText(/Trades close/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Make an offer" })).toBeDisabled();
});

test("an offer that overfills your roster asks who you drop", async ({ page }) => {
  // Both fixture rosters sit at the limit, as most real ones do by midseason,
  // so a lopsided offer needs somebody let go — named with the offer.
  await page.goto("/preview/trades");
  await page.getByRole("button", { name: "Make an offer" }).click();
  const sheet = page.getByRole("dialog", { name: "Make a trade offer" });
  const send = sheet.getByRole("button", { name: "Send offer" });

  // Two of theirs for nothing of mine: I would be at four, so two must go.
  await sheet.getByLabel("You get: Zay Flowers").check();
  await sheet.getByLabel("You get: Rome Odunze").check();
  await expect(sheet.getByRole("alert")).toContainText("puts you at 4, over the 2-man limit");
  await expect(send).toBeDisabled();

  await sheet.getByLabel("Drop: Tyjae Spears").check();
  await expect(sheet.getByRole("alert")).toContainText("Pick 1 more");
  await sheet.getByLabel("Drop: Jaylen Wright").check();
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(send).toBeEnabled();

  // Ask for one fewer and a drop is surplus: the sheet says so and holds Send,
  // and no more can be ticked than the deal needs.
  await sheet.getByLabel("You get: Rome Odunze").uncheck();
  await expect(sheet.getByRole("alert")).toContainText("only needs 1 dropped");
  await expect(send).toBeDisabled();
  await sheet.getByLabel("Drop: Jaylen Wright").uncheck();
  await expect(send).toBeEnabled();
  await expect(sheet.getByLabel("Drop: Jaylen Wright")).toBeDisabled();

  // A man put into the deal comes off the drop list, and stops counting.
  await sheet.getByLabel("You get: Rome Odunze").check();
  await sheet.getByLabel("Drop: Jaylen Wright").check();
  await sheet.getByLabel("You give: Tyjae Spears").check();
  await expect(sheet.getByLabel("Drop: Tyjae Spears")).toHaveCount(0);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(send).toBeEnabled();
});

test("an offer that overfills their roster is theirs to settle", async ({ page }) => {
  await page.goto("/preview/trades");
  await page.getByRole("button", { name: "Make an offer" }).click();
  const sheet = page.getByRole("dialog", { name: "Make a trade offer" });

  // One of mine for nothing: Prime Cut would be at three. Allowed — they
  // choose who goes when they accept — and said, not blocked.
  await sheet.getByLabel("You give: Tyjae Spears").check();
  await expect(sheet.getByText(/puts Prime Cut at 3.*They choose who to drop when they accept/)).toBeVisible();
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Send offer" })).toBeEnabled();
});

test("an offer's drops read on its card", async ({ page }) => {
  await page.goto("/preview/trades");
  const mine = page.locator(".card", { hasText: "you offered Filet Force" });
  await expect(mine.getByText("Dropped to make room")).toBeVisible();
  await expect(mine.locator(".offer__drop", { hasText: "Tank Bigsby" })).toContainText("yours");
});

test("accepting onto a full roster asks who goes first", async ({ page }) => {
  await page.goto("/preview/trades");
  const gift = page.locator(".card", { hasText: "Smokehouse Six offered you" });
  await gift.getByRole("button", { name: "Accept" }).click();

  const sheet = page.getByRole("dialog", { name: "Choose who to drop" });
  const go = sheet.getByRole("button", { name: /Drop and accept|Pick 1 more/ });
  await expect(go).toHaveText("Pick 1 more");
  await expect(go).toBeDisabled();

  await sheet.getByLabel("Drop Jaylen Wright").check();
  // One is all it needs, so the rest cannot be ticked.
  await expect(sheet.getByLabel("Drop Tyjae Spears")).toBeDisabled();
  await expect(go).toHaveText("Drop and accept");
  await expect(go).toBeEnabled();

  // An even swap needs nothing, so it never asks.
  await sheet.getByRole("button", { name: "Never mind" }).click();
  await page.locator(".card", { hasText: "Prime Cut offered you" }).getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("dialog", { name: "Choose who to drop" })).toHaveCount(0);
});

test("a toast is drawn above an open sheet, not under it", async ({ page }) => {
  await page.goto("/preview/trades");
  const z = await page.evaluate(() => {
    const probe = (cls: string) => {
      const el = document.createElement("div");
      el.className = cls;
      document.body.appendChild(el);
      const v = Number(getComputedStyle(el).zIndex);
      el.remove();
      return v;
    };
    return { toasts: probe("toasts"), modal: probe("modal"), sheet: probe("sheet__wrap") };
  });
  expect(z.toasts).toBeGreaterThan(z.modal);
  expect(z.toasts).toBeGreaterThan(z.sheet);
});
