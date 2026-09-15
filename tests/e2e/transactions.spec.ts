import { expect, test } from "@playwright/test";

/**
 * The transaction centre.
 *
 * The screen itself needs a session and a drafted league, so what a signed-out
 * test can hold still is the routing: that the one destination is gated like
 * every other, and that the four routes it replaced still resolve. Those four
 * are in bookmarks, in the `url` a push notification carries (`/trades` and
 * `/waivers` are written into the notification triggers) and in the `next=` a
 * sign-in hands back — a 404 on any of them is a manager who tapped a
 * notification and got nothing.
 */

test("the centre is behind the session", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);
});

for (const path of ["/players", "/waivers", "/trades", "/ledger"]) {
  test(`${path} still resolves`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    // Gated before the redirect to the tab can run, so what a signed-out
    // visitor gets is the door — carrying the path it was asked for, which is
    // what lands them on the right tab once they are through it.
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2F${path.slice(1)}$`));
  });
}

/**
 * On a phone the centre is in the tab bar, not behind More. Signing a man off
 * the wire on a Wednesday is the commonest thing a manager does on his phone
 * after setting a lineup. The bar says Moves — "Transactions" does not fit
 * under an icon at a fifth of a phone — and reads out the full name.
 */
test("the centre is a phone tab", async ({ page }, testInfo) => {
  await page.goto("/preview/players");
  const bar = page.locator(".tabbar");
  const tab = bar.getByRole("link", { name: "Transactions" });
  if (testInfo.project.name === "mobile") {
    await expect(bar).toBeVisible();
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText("Moves");
    await expect(tab).toHaveAttribute("href", "/transactions");
    // Five tabs and More, and nothing hangs off the edge of the screen.
    await expect(bar.locator(".tabbar__item")).toHaveCount(6);
    const width = page.viewportSize()!.width;
    const doc = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(doc).toBeLessThanOrEqual(width);
    for (const item of await bar.locator(".tabbar__item").all()) {
      const clipped = await item.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(clipped, `${await item.textContent()} is clipped`).toBe(false);
    }
  } else {
    await expect(bar).toBeHidden();
  }
});
