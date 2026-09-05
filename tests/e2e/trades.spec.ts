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
