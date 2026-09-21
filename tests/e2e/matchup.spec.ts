import { expect, test } from "@playwright/test";

/**
 * One matchup, the whole screen.
 *
 * The live route needs a session, a drafted league and an afternoon of real
 * football, so `/preview/matchup` — the same invented Sunday `/preview/matchups`
 * runs on, seen one game at a time — is what a test can hold still.
 *
 * The assertions are the promises the redesign made, in the order it made
 * them: that the matchup is readable at a glance, that switching games costs
 * nothing, that the stat lines stay out of the way until asked, that a live
 * player is obvious, and that the score follows you into the lineup.
 */

test("the matchup answers itself without a scroll", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/matchup");

  const head = page.locator(".mhead");

  // Both teams, both managers, both records — balanced either side.
  await expect(head.locator(".mhead__name")).toHaveCount(2);
  await expect(head.locator(".mhead__name").first()).toHaveText("Dry Aged Dynasty");
  await expect(head.locator(".mhead__name").last()).toHaveText("The Porterhouse");
  await expect(head.locator(".mhead__who").first()).toContainText("Dev");
  await expect(head.locator(".mhead__who").first()).toContainText("7–3");

  // Two scores, and under each one where it is going.
  const pts = head.locator(".mhead__pts");
  await expect(pts).toHaveCount(2);
  for (const text of await pts.allTextContents()) expect(text).toMatch(/^\d+\.\d$/);
  await expect(head.locator(".mhead__proj").first()).toHaveText(/^proj\. \d+\.\d$/);

  // Who is winning, gilded rather than merely coloured differently — and said
  // in text, because a bar alone is a claim only some readers can read.
  await expect(head.locator(".mhead__side[data-lead='true']")).toHaveCount(1);
  const odds = head.locator(".sb__odds-nums span");
  await expect(odds).toHaveCount(2);
  for (const text of await odds.allTextContents()) expect(text).toMatch(/^(<1%|>99%|\d{1,3}%)$/);

  // And whether the game is still a game.
  await expect(head.locator(".mhead__left-side")).toHaveCount(2);
  await expect(head.locator(".mhead__left-side").first()).toContainText("players left");

  expect(errors).toEqual([]);
});

test("the header plus six lineup rows fit on a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "a density claim about a phone");
  await page.goto("/preview/matchup");

  const fold = page.viewportSize()!.height;
  const head = await page.locator(".mhead").boundingBox();
  expect(head).not.toBeNull();

  // The preview route carries a fixture banner and a stage switcher the live
  // route does not, so the budget is measured from the header down rather
  // than from the top of the document.
  const rows = page.locator(".sb__vs-slot");
  await expect(rows).toHaveCount(9);
  let visible = 0;
  for (let i = 0; i < 9; i++) {
    const box = await rows.nth(i).boundingBox();
    if (box && box.y + box.height <= head!.y + fold) visible++;
  }
  expect(visible).toBeGreaterThanOrEqual(6);
});

test("switching games is a state change, not a page load", async ({ page }) => {
  await page.goto("/preview/matchup");
  await expect(page.locator(".mhead__name").first()).toHaveText("Dry Aged Dynasty");

  // A mark on `window` that only survives if the document is never replaced.
  await page.evaluate(() => { (window as unknown as Record<string, number>).__stayed = 1; });

  await page.locator(".mnav__game").nth(2).click();

  await expect(page.locator(".mhead__name").first()).toHaveText("Bone-In Bandits");
  await expect(page.locator(".mnav__game[aria-current='true'] ")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__stayed)).toBe(1);

  // And every other game in the week is still one tap away from here.
  await expect(page.locator(".mnav__game")).toHaveCount(3);
});

test("the stat line waits to be asked for", async ({ page }) => {
  await page.goto("/preview/matchup");

  // Nothing is disclosed by default — that is the whole reason the row is
  // short enough to fit six of on a phone.
  await expect(page.locator(".sb__box")).toHaveCount(0);

  const first = page.locator(".sb__vs-slot").first();
  await first.locator(".sb__vs-pts").first().click();
  await expect(first.locator(".sb__box").first()).toHaveText(/\d+\/\d+, \d+ YD/);

  // And it goes away again.
  await first.locator(".sb__vs-pts").first().click();
  await expect(first.locator(".sb__box")).toHaveCount(0);
});

test("a player's own page is still one modified click away", async ({ page }) => {
  await page.goto("/preview/matchup");
  // The plain tap opens his stat line rather than navigating — but the badge
  // is still a link, so "open in new tab" and a cmd-click reach his page.
  const badge = page.locator(".sb__vs-cell .pbadge").first();
  await expect(badge).toHaveAttribute("href", /^\/player\//);
});

test("a live player is obvious, a finished one is quiet", async ({ page }) => {
  await page.goto("/preview/matchup");

  // Live says so in words, not only in wine and a pulsing dot.
  const live = page.locator(".sb__mark[data-state='live']").first();
  await expect(live).toContainText("Live");
  await expect(live).toContainText(/Q\d/);
  await expect(live.locator(".sb__pip")).toHaveCount(1);

  await expect(page.locator(".sb__mark[data-state='final']").first()).toHaveText("Final");

  // Before kickoff the row says who he is playing and when, and claims no
  // clock it does not have.
  await page.getByRole("button", { name: "Nothing kicked", exact: true }).click();
  await expect(page.locator(".sb__mark[data-state='live']")).toHaveCount(0);
  await expect(page.locator(".sb__mark[data-state='pre']").first()).toContainText(/vs|@/);
});

test("the score follows you into the lineup", async ({ page }) => {
  await page.goto("/preview/matchup");

  const stuck = page.locator(".mstick");
  await expect(stuck).toHaveAttribute("data-on", "false");

  await page.locator(".sb__vs-slot").nth(6).scrollIntoViewIfNeeded();
  await expect(stuck).toHaveAttribute("data-on", "true");

  // Both abbreviations and both numbers, so the bar answers "which game is
  // this" and "what is the score" on its own.
  await expect(stuck.locator(".mstick__side")).toHaveCount(2);
  await expect(stuck.locator(".mstick__side").first()).toContainText(/\d+\.\d/);
  await expect(stuck.locator(".mstick__state")).toHaveText(/live/i);
});

test("the bench is there, and out of the way", async ({ page }) => {
  await page.goto("/preview/matchup");

  const toggle = page.getByRole("button", { name: /^Bench/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // The count is on the closed control, because "Bench" alone does not say
  // whether opening it is worth the tap.
  await expect(toggle).toContainText("3 · 2");
  await expect(page.locator(".sb__vs-slot[data-bench='true']")).toHaveCount(0);

  await toggle.click();
  // Three against two: one side is a man short, and the rows must not invent
  // a pairing to fill the gap.
  await expect(page.locator(".sb__vs-slot[data-bench='true']")).toHaveCount(3);
  await expect(page.locator(".sb__vs-slot[data-bench='true']").last().locator(".sb__vs-cell"))
    .toHaveCount(2);
  // A bench row carries its own position, since there is no shared slot pill.
  await expect(page.locator(".sb__vs-slot[data-bench='true'] .sb__vs-pos").first()).toHaveText("RB");
});
