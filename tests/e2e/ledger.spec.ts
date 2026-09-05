import { expect, test } from "@playwright/test";

test("the ledger is behind the session", async ({ page }) => {
  await page.goto("/ledger");
  await expect(page).toHaveURL(/\/login/);
});

test("every kind of move is written as a sentence", async ({ page }) => {
  await page.goto("/preview/ledger");

  // A trade names both halves, because it is the only shape where two teams
  // each give something up.
  await expect(page.getByText(/Chuck Wagon get/)).toBeVisible();
  await expect(page.getByText(/Gridiron Butchers get/)).toBeVisible();

  // A waiver claim that named somebody to make way reads as one move, not two.
  await expect(
    page.getByText(/won[\s\S]*Jaylen Wright[\s\S]*on waivers[\s\S]*released[\s\S]*Tyjae Spears/),
  ).toBeVisible();

  // A plain signing, and a release with nothing coming back.
  await expect(page.getByText(/Brisket Brigade\s*signed/)).toBeVisible();
  await expect(page.getByText(/Chuck Wagon\s*released/)).toBeVisible();
});

test("the day headings say today and yesterday", async ({ page }) => {
  await page.goto("/preview/ledger");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Yesterday" })).toBeVisible();
});

test("the filters narrow the list and say how many are left", async ({ page }) => {
  await page.goto("/preview/ledger");
  await expect(page.getByText("6 moves")).toBeVisible();

  await page.getByRole("button", { name: "Trades" }).click();
  await expect(page.getByText("1 move")).toBeVisible();
  await expect(page.getByText(/Chuck Wagon\s*released/)).toHaveCount(0);

  await page.getByRole("button", { name: "Waivers" }).click();
  await expect(page.getByText("2 moves")).toBeVisible();

  // A filter that matches nothing explains itself rather than showing a blank.
  await page.getByRole("button", { name: "Trades" }).click();
  await page.getByLabel("Team").selectOption("Brisket Brigade");
  await expect(page.getByText("No moves match that. Try another filter.")).toBeVisible();
});

test("a league that has not moved anybody says so", async ({ page }) => {
  await page.goto("/preview/ledger");
  await page.getByRole("button", { name: "Quiet" }).click();
  await expect(
    page.getByText("Nothing has moved yet. Signings, waiver claims and trades all end up here."),
  ).toBeVisible();
});
