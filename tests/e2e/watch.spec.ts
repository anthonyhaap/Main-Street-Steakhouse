import { expect, test } from "@playwright/test";

/**
 * The front door of a watch link.
 *
 * `/watch` is on the proxy's PUBLIC list because its visitor has no session
 * yet; the route signs them in itself. So what these assert is that a bad link
 * is turned away by the route, with a reason, and not by the proxy's session
 * check, which would send them to sign in with `next=` set and no reason given.
 *
 * Neither case reaches the database: a token that is not 64 hex characters is
 * refused before anything is asked. Everything past that (redeeming, reading,
 * the refusal of every write) is supabase/tests/watch_links.sql.
 */

for (const token of ["not-a-token", "a".repeat(63), "A".repeat(64)]) {
  test(`a malformed watch link (${token.slice(0, 12)}…) is refused with a reason`, async ({ page }) => {
    await page.goto(`/watch/${token}`);
    await expect(page).toHaveURL(/\/login\?error=/);
    expect(new URL(page.url()).searchParams.get("next")).toBeNull();
    await expect(page.getByText(/expired or been switched off/i)).toBeVisible();
  });
}
