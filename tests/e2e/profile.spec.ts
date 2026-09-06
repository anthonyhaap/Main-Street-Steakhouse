import { expect, test } from "@playwright/test";

/**
 * A manager's career, opened from his card on the wall.
 *
 * The fixture at /preview/history is ten invented seasons for twelve invented
 * managers, generated from a seed — so the profile can be opened, read and
 * checked against the wall it was derived from without a session or an import.
 */

test("a card opens the career under it, and says so in the URL", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/history");

  await expect(page.locator(".prof")).toHaveCount(0);

  const card = page.getByRole("button", { name: "Mike's career" });
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await card.click();

  const prof = page.locator(".prof");
  await expect(prof).toBeVisible();
  await expect(prof.getByRole("heading", { name: "Mike" })).toBeVisible();
  await expect(card).toHaveAttribute("aria-expanded", "true");

  // "Look at his record" is a thing said in a group chat, with a link.
  await expect(page).toHaveURL(/\?manager=Mike$/);
  expect(errors).toEqual([]);
});

test("a link straight to a career opens it", async ({ page }) => {
  await page.goto("/preview/history?manager=Dave");
  await expect(page.locator(".prof").getByRole("heading", { name: "Dave" })).toBeVisible();
});

test("the back button closes the career rather than leaving the wall", async ({ page }) => {
  await page.goto("/preview/history");
  await page.getByRole("button", { name: "Mike's career" }).click();
  await expect(page.locator(".prof")).toBeVisible();

  await page.goBack();
  await expect(page.locator(".prof")).toHaveCount(0);
  // Still on the wall.
  await expect(page.getByRole("heading", { name: "Champions" })).toBeVisible();
});

test("closing it clears the link", async ({ page }) => {
  await page.goto("/preview/history?manager=Mike");
  await page.getByRole("button", { name: "Close the profile" }).click();
  await expect(page.locator(".prof")).toHaveCount(0);
  await expect(page).not.toHaveURL(/manager=/);
});

test("the cabinet holds what was won and what was not", async ({ page }) => {
  await page.goto("/preview/history?manager=Mike");
  const cab = page.locator(".prof__cab");
  await expect(cab).toBeVisible();

  // Two titles, and the years on them: a cabinet without dates is a boast.
  await expect(cab.locator('.prof__trophy[data-good="true"]').first()).toContainText("Champion x2");
  for (const row of await cab.locator(".prof__trophy").all()) {
    await expect(row.locator("span")).toHaveText(/^\d{4}(, \d{4})*$/);
  }
  await expect(cab.locator('.prof__trophy[data-good="false"]')).toHaveCount(0);
});

test("a wooden spoon is not dressed up as a trophy", async ({ page }) => {
  await page.goto("/preview/history?manager=Ray");

  // Six last-place finishes. It belongs in the cabinet — a career is the whole
  // record — but the good/bad split is in the markup and not only in the
  // colour, so it cannot be read as six championships.
  const spoon = page.locator('.prof__trophy[data-good="false"]');
  await expect(spoon).toHaveCount(1);
  await expect(spoon).toContainText("Wooden spoon x6");
  await expect(page.locator('.prof__trophy[data-good="true"]')).toHaveCount(0);
});

test("the career lists every season the manager played", async ({ page }) => {
  await page.goto("/preview/history?manager=Mike");
  await expect(page.locator(".prof__tbl")).toBeVisible();

  // Ten invented seasons, newest first.
  const years = await page.locator(".prof__tbl tbody tr td:first-child").allInnerTexts();
  expect(years).toHaveLength(10);
  expect(years).toEqual([...years].sort((a, b) => Number(b) - Number(a)));
  expect(years[0]).toBe("2025");
});

test("the profile and the wall's grid are the same claim", async ({ page }) => {
  await page.goto("/preview/history?manager=Mike");

  // The head-to-head list is read from the same grid the wall paints as a heat
  // map. If they ever disagree, one of them is lying to a league that has both
  // on the same screen — so they are checked against each other rather than
  // each against a number typed into this test.
  await expect(page.locator(".prof__h2h")).toBeVisible();
  const fromProfile = new Map<string, string>();
  for (const li of await page.locator(".prof__h2h li").all()) {
    const who = (await li.locator("span").innerText()).trim();
    fromProfile.set(who, (await li.locator("b").innerText()).trim());
  }
  expect(fromProfile.size).toBe(11);

  for (const [opponent, record] of fromProfile) {
    const cell = page.locator(`.h2h__cell[title^="Mike vs ${opponent}:"]`);
    const title = await cell.getAttribute("title");
    // The grid writes its records with an en dash and the profile with a
    // hyphen; the numbers are what has to match.
    const onWall = (title ?? "").split(":")[1].trim().replace(/–/g, "-");
    expect(onWall, `Mike vs ${opponent}`).toBe(record);
  }
});

test("the one he owns and the one who owns him are never the same man", async ({ page }) => {
  await page.goto("/preview/history?manager=Mike");
  const line = page.locator(".prof__owns");
  await expect(line).toBeVisible();

  const owns = await line.locator("b").allInnerTexts();
  if (owns.length === 2) expect(owns[0]).not.toBe(owns[1]);
});
