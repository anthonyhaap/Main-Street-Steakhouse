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

test("an offer that would overfill a roster says so before Send", async ({ page }) => {
  // Both fixture rosters sit at the limit, as most real ones do by midseason.
  // The database refuses a lopsided offer either way; the sheet must say why
  // before the button, not in a toast nobody could see.
  await page.goto("/preview/trades");
  await page.getByRole("button", { name: "Make an offer" }).click();
  const sheet = page.getByRole("dialog", { name: "Make a trade offer" });
  const send = sheet.getByRole("button", { name: "Send offer" });

  // Two of theirs for nothing of mine: I would be at four.
  await sheet.getByLabel("You get: Zay Flowers").check();
  await sheet.getByLabel("You get: Rome Odunze").check();
  await expect(sheet.getByRole("alert")).toContainText("puts you at 4, over the 2-man limit");
  await expect(send).toBeDisabled();

  // One for one fits.
  await sheet.getByLabel("You get: Rome Odunze").uncheck();
  await sheet.getByLabel("You give: Tyjae Spears").check();
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(send).toBeEnabled();

  // And the other side is held to the same limit.
  await sheet.getByLabel("You get: Zay Flowers").uncheck();
  await expect(sheet.getByRole("alert")).toContainText("puts Prime Cut at 3");
  await expect(send).toBeDisabled();
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
