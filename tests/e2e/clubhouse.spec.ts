import { expect, test } from "@playwright/test";

test("invite and sign-in entry points are responsive and error free", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/join");
  await expect(page.getByRole("heading", { name: "Claim your team" })).toBeVisible();
  await expect(page.getByLabel("Your email")).toBeVisible();
  await expect(page.getByLabel("Choose a password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter the league" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(errors).toEqual([]);
});
