import { expect, test } from "@playwright/test";

/**
 * What the front door lets through.
 *
 * `src/proxy.ts` now returns early for the public screens instead of asking
 * the auth server who is calling — `getUser()` is a network round trip, not a
 * cookie read, and it was being paid on every service-worker fetch, every
 * preview screen and every cron POST to learn something none of them use.
 *
 * That early return sits in front of the session check, so the list it keys on
 * and the list the redirect keys on have to stay the same list. If they ever
 * drift, either a public screen starts demanding a session or — much worse — a
 * private one stops. Both directions are asserted here.
 */

/** Every entry on the proxy's PUBLIC list, reachable with no session. */
const PUBLIC = [
  "/login",
  "/join",
  "/preview/standings",
  "/share/matchup/00000000-0000-0000-0000-000000000000",
  "/manifest.webmanifest",
  "/sw.js",
];

for (const path of PUBLIC) {
  test(`${path} opens without a session`, async ({ page }) => {
    const response = await page.goto(path);

    // Being sent to /login is the thing ruled out — that is what "gated by
    // accident" looks like. The status is deliberately not asserted to be a
    // success: the share id above belongs to no matchup and rightly 404s, and
    // a 404 from the page is a public screen answering, not a door refusing.
    if (path !== "/login") {
      expect(new URL(page.url()).pathname, path).not.toBe("/login");
    }
    expect(response?.status(), path).toBeLessThan(500);
  });
}

test("the cron drain is public to the router but not to the caller", async ({ request }) => {
  // It is on the PUBLIC list because Vercel Cron arrives with no cookie and
  // could not obtain one. That must not mean it is open: it checks a bearer
  // CRON_SECRET itself, and refuses everything when that variable is unset.
  // So the right answer here is a refusal, and specifically not a redirect to
  // a login page a cron job cannot complete.
  const response = await request.post("/api/push/drain", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.status()).toBeLessThan(500);
});

/** A sample of what must still be behind the session. */
const PRIVATE = ["/", "/standings", "/history", "/matchups", "/transactions", "/team", "/chat", "/admin"];

for (const path of PRIVATE) {
  test(`${path} still needs a session`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  });
}

test("the way back is carried through the door", async ({ page }) => {
  // The redirect keeps where you were going, so signing in does not dump you
  // on the front page having forgotten the link you followed.
  await page.goto("/standings");
  await expect(page).toHaveURL(/next=%2Fstandings|next=\/standings/);
});
