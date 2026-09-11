import { expect, test } from "@playwright/test";

/**
 * The player pool.
 *
 * The real tab needs a session and a drafted league, so /preview/players is
 * what a test can hold still. What is asserted is the one decision the tab
 * makes for a manager — it opens on who is available — and that the whole
 * pool, the count in the head and the empty state all agree with it.
 */

test("the pool opens on who is available", async ({ page }) => {
  await page.goto("/preview/players");
  // A free agent is offered; a man on the wire is offered a claim, not a signing.
  await expect(page.getByRole("button", { name: "Sign Tyler Allgeier" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim Cade Otton off waivers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign Cade Otton" })).toHaveCount(0);
  // Nobody on a roster — not another manager's, and not your own.
  await expect(page.getByText("Ja'Marr Chase")).toHaveCount(0);
  await expect(page.getByText("Trey McBride")).toHaveCount(0);
  // The head counts the two kinds of available separately.
  await expect(page.getByText(/4 free · 1 on waivers/)).toBeVisible();
});

test("everyone is one tap away, with who has whom", async ({ page }) => {
  await page.goto("/preview/players");
  await page.getByRole("button", { name: "Everyone" }).click();
  await expect(page.getByText("Ja'Marr Chase")).toBeVisible();
  await expect(page.getByText("Prime Cut").first()).toBeVisible();
  // Your own are the ones you may release, and it takes two clicks.
  const release = page.getByRole("button", { name: "Release Trey McBride" });
  await expect(release).toBeVisible();
  await release.click();
  await expect(page.getByRole("button", { name: "Confirm releasing Trey McBride" })).toHaveText("Sure?");
});

test("a search for a rostered man says where he is", async ({ page }) => {
  await page.goto("/preview/players");
  await page.getByLabel("Search players").fill("Bijan");
  await expect(page.getByText(/Nobody available matches that/)).toBeVisible();
  await expect(page.getByText(/1 is on a roster/)).toBeVisible();
  await page.getByRole("button", { name: "Show everyone" }).click();
  await expect(page.getByText("Bijan Robinson")).toBeVisible();
  await expect(page.getByText("Chuck Wagon")).toBeVisible();
});

test("a full roster asks who makes way", async ({ page }) => {
  await page.goto("/preview/players");
  await page.getByRole("button", { name: "Full roster" }).click();
  await page.getByRole("button", { name: "Sign Tyler Allgeier" }).click();
  const picker = page.getByRole("dialog", { name: /Sign Tyler Allgeier/ });
  await expect(picker).toBeVisible();
  await expect(picker.getByText("Rome Odunze")).toBeVisible();
  await picker.getByRole("button", { name: "Never mind" }).click();
  await expect(picker).toBeHidden();
});
