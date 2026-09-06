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
