import { expect, test } from "@playwright/test";

/**
 * The wire.
 *
 * The real screen needs a session, a drafted league and somebody to have
 * dropped a player, so /preview/waivers is what a test can hold still. The
 * assertions are the sentences and the affordances, because between them they
 * are the difference between a waiver system and a list of names.
 */

test("the wire is behind the session", async ({ page }) => {
  await page.goto("/waivers");
  await expect(page).toHaveURL(/\/login/);
});

test("it says when it settles, and that claims are blind", async ({ page }) => {
  await page.goto("/preview/waivers");
  await expect(page.getByText(/Next settlement/)).toBeVisible();
  await expect(page.getByText(/Claims are blind until then/)).toBeVisible();
  await expect(page.getByText(/your call:/)).toBeVisible();
});

test("a claim already in cannot be entered twice", async ({ page }) => {
  await page.goto("/preview/waivers");
  // Jaylen Wright is claimed in the fixture; Adonai Mitchell is not.
  await expect(page.getByRole("button", { name: "Claim Adonai Mitchell" })).toBeEnabled();
  // The accessible name follows the state, so a screen reader is told the same
  // thing the button says rather than being invited to claim him again.
  const claimed = page.getByRole("button", { name: "Jaylen Wright is already claimed" });
  await expect(claimed).toBeDisabled();
  await expect(claimed).toHaveText("Claimed");
});

test("the claim sheet offers room-permitting as well as a release", async ({ page }) => {
  await page.goto("/preview/waivers");
  await page.getByRole("button", { name: "Claim Adonai Mitchell" }).click();
  const sheet = page.getByRole("dialog", { name: /Claim Adonai Mitchell/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Only if I have room")).toBeVisible();
  await expect(sheet.getByText(/Release Trey McBride/)).toBeVisible();
  await sheet.getByRole("button", { name: "Never mind" }).click();
  await expect(sheet).toBeHidden();
});

test("the ordering controls know the ends of the list", async ({ page }) => {
  await page.goto("/preview/waivers");
  // Two claims: the first cannot move up, the last cannot move down.
  await expect(page.getByRole("button", { name: "Move Jaylen Wright up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Cade Otton down" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Jaylen Wright down" })).toBeEnabled();
});

test("a quiet wire explains itself rather than showing nothing", async ({ page }) => {
  await page.goto("/preview/waivers");
  await page.getByRole("button", { name: "Quiet" }).click();
  await expect(page.getByText(/Nobody is on the wire/)).toBeVisible();
  await expect(page.getByText(/anyone never owned is a free agent/)).toBeVisible();
  await expect(page.getByText(/Nothing claimed/)).toBeVisible();
});
