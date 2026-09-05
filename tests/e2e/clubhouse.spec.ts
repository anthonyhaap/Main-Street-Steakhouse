import { expect, test } from "@playwright/test";

test("invite and sign-in entry points are responsive and error free", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // /join is now reachable only with the token from an invite mail. Arriving
  // without one — or with a guess — gets the same refusal and no form, which is
  // the point: the screen must not become a way to test whether an address or a
  // token is real.
  await page.goto("/join");
  await expect(page.getByRole("heading", { name: "This link won't open" })).toBeVisible();
  await expect(page.getByLabel("Your email")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enter the league" })).toHaveCount(0);

  await page.goto("/join?t=00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "This link won't open" })).toBeVisible();

  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(errors).toEqual([]);
});
