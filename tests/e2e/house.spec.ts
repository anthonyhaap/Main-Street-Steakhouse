import { expect, test } from "@playwright/test";

test("the House is behind the session", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login/);
});

test("what was said and what was done sit in one column, and read differently", async ({ page }) => {
  await page.goto("/preview/house");

  // The merge, which is the whole feature: an argument and the thing it is
  // about, adjacent.
  await expect(page.getByText("that trade is a robbery and you all know it")).toBeVisible();
  await expect(page.getByText("Chuck Wagon and Gridiron Butchers made a trade")).toBeVisible();

  // A league-run settlement carries its detail but no author, because nobody
  // did it.
  await expect(page.getByText("Waivers cleared: 4 of 7 claims awarded")).toBeVisible();
  await expect(page.getByText("Week 3").first()).toBeVisible();

  // A manager's own line is his, and the House speaks as itself.
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  await expect(page.getByText("The House", { exact: true }).last()).toBeVisible();
});

test("the filters separate talk from moves", async ({ page }) => {
  await page.goto("/preview/house");

  await page.getByRole("button", { name: "Moves" }).click();
  await expect(page.getByText("Chuck Wagon and Gridiron Butchers made a trade")).toBeVisible();
  await expect(page.getByText("that trade is a robbery and you all know it")).toHaveCount(0);

  await page.getByRole("button", { name: "Talk" }).click();
  await expect(page.getByText("that trade is a robbery and you all know it")).toBeVisible();
  await expect(page.getByText("Chuck Wagon and Gridiron Butchers made a trade")).toHaveCount(0);

  await page.getByRole("button", { name: "Everything" }).click();
  await expect(page.getByText("Chuck Wagon and Gridiron Butchers made a trade")).toBeVisible();
});

test("a matchup line says which game it was said about", async ({ page }) => {
  await page.goto("/preview/house");
  await expect(page.getByRole("link", { name: /Week 3 · Gridiron Butchers vs Prime Cut/ })).toBeVisible();
});

test("an empty House explains what will fill it", async ({ page }) => {
  await page.goto("/preview/house");
  await page.getByRole("button", { name: "Quiet" }).click();
  await expect(page.getByText(/Signings, waiver results and trades land here on their own/)).toBeVisible();
});

test("a reaction is a toggle, and says who is in the count", async ({ page }) => {
  await page.goto("/preview/house");

  // A tally you are already part of reads as pressed, and pressing it takes you
  // back out rather than adding a second flame.
  const flame = page.getByRole("button", { name: /^🔥 5, including you$/ });
  await expect(flame).toBeVisible();
  await expect(flame).toHaveAttribute("aria-pressed", "true");

  await flame.click();
  await expect(page.getByRole("button", { name: /^🔥 4$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^🔥 4$/ })).toHaveAttribute("aria-pressed", "false");

  // And back again.
  await page.getByRole("button", { name: /^🔥 4$/ }).click();
  await expect(page.getByRole("button", { name: /^🔥 5, including you$/ })).toBeVisible();
});

test("a line nobody has reacted to offers one quiet button, not six", async ({ page }) => {
  await page.goto("/preview/house");

  // Six buttons under every row is noise; the palette opens on demand.
  const adders = page.getByRole("button", { name: "Add a reaction" });
  await expect(adders.first()).toBeVisible();

  await adders.first().click();
  await expect(page.getByRole("button", { name: "React with 😂" })).toBeVisible();

  await page.getByRole("button", { name: "React with 😂" }).click();
  await expect(page.getByRole("button", { name: /^😂 1, including you$/ })).toBeVisible();
});
