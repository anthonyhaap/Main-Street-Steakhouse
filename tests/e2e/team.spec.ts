import { expect, test } from "@playwright/test";

/**
 * The My Team desk and the NFL wire it reads are both behind the session.
 *
 * The wire route proxies a third-party feed, so leaving it open would turn this
 * deployment into an unauthenticated relay for anyone who found the URL. The
 * middleware already covers it — this is the test that keeps it covered when
 * someone adds the next public path.
 */

test("the team desk requires a session", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?next=%2Fteam|\/login\?next=\/team/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("the NFL wire is not an open proxy", async ({ request }) => {
  const res = await request.get("/api/nfl/wire");
  expect(res.url()).toContain("/login");

  const body = await res.text();
  expect(body).not.toContain('"articles"');
});
