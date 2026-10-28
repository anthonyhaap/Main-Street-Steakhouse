import { expect, test } from "@playwright/test";

/**
 * One matchup, the whole screen.
 *
 * The live route needs a session, a drafted league and an afternoon of real
 * football, so `/preview/matchup` — the same invented Sunday `/preview/matchups`
 * runs on, seen one game at a time — is what a test can hold still.
 *
 * The assertions are the promises the screen makes: that exactly one matchup
 * is on it, that stepping to another costs nothing, that every row says
 * everything it knows, that a live player is obvious, and that the score is
 * never off screen.
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

test("only one matchup is on the screen", async ({ page }) => {
  await page.goto("/preview/matchup");

  // One scoreline in the pager, and it is the game the header is about.
  await expect(page.locator(".mpager__game")).toHaveCount(1);
  await expect(page.locator(".mpager__side")).toHaveCount(2);

  // No other game in the week appears anywhere — not as a score, not as a
  // name. The place to find another game worth watching is /matchups; this
  // screen is for watching one.
  for (const other of ["Prime Cut", "Gridiron Butchers", "Bone-In Bandits", "Wagyu Warriors"]) {
    await expect(page.getByText(other, { exact: true })).toHaveCount(0);
  }

  // Stepping to one puts it on the screen and takes the last one off.
  await page.locator(".mpager__arrow[data-dir='next']").click();
  await expect(page.locator(".mhead__name").first()).toHaveText("Prime Cut");
  await expect(page.getByText("Dry Aged Dynasty", { exact: true })).toHaveCount(0);
});

test("the header and five lineup rows fit on a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "a density claim about a phone");
  await page.goto("/preview/matchup");

  const fold = page.viewportSize()!.height;
  const head = await page.locator(".mhead").boundingBox();
  expect(head).not.toBeNull();

  // The preview route carries a fixture banner and a stage switcher the live
  // route does not, so the budget is measured from the header down rather
  // than from the top of the document.
  //
  // Five, not the six an earlier version of this screen managed: a row that
  // carries its own stat line is sixteen pixels taller than one that hides
  // it behind a tap, and showing every one of them is the trade this design
  // makes on purpose. The floor is here so the trade stays a trade — if a
  // later change spends another row's worth of height, this says so.
  const rows = page.locator(".sb__vs-row");
  await expect(rows).toHaveCount(9);
  let visible = 0;
  for (let i = 0; i < 9; i++) {
    const box = await rows.nth(i).boundingBox();
    if (box && box.y + box.height <= head!.y + fold) visible++;
  }
  expect(visible).toBeGreaterThanOrEqual(5);
});

test("the lineup runs to the glass on a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "a claim about a phone's width");
  await page.goto("/preview/matchup");

  const width = page.viewportSize()!.width;
  const row = await page.locator(".sb__vs-row").first().boundingBox();
  expect(row).not.toBeNull();
  // The page's own gutter is right for a column of cards and wrong for the
  // one element here that is a table: every pixel it gives back is a pixel
  // the stat line inside it gets to use.
  expect(row!.x).toBeLessThanOrEqual(1);
  expect(row!.width).toBeGreaterThanOrEqual(width - 1);
});

test("stepping games is a state change, not a page load", async ({ page }) => {
  await page.goto("/preview/matchup");
  await expect(page.locator(".mhead__name").first()).toHaveText("Dry Aged Dynasty");

  // A mark on `window` that only survives if the document is never replaced.
  await page.evaluate(() => { (window as unknown as Record<string, number>).__stayed = 1; });

  await page.locator(".mpager__arrow[data-dir='next']").click();
  await page.locator(".mpager__arrow[data-dir='next']").click();

  await expect(page.locator(".mhead__name").first()).toHaveText("Bone-In Bandits");
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__stayed)).toBe(1);

  // The end of the week is a dead column, not a button that goes nowhere.
  await expect(page.locator("button.mpager__arrow[data-dir='next']")).toHaveCount(0);
  await expect(page.locator("button.mpager__arrow[data-dir='prev']")).toHaveCount(1);
});

test("every row says everything it knows", async ({ page }) => {
  await page.goto("/preview/matchup");

  const first = page.locator(".sb__vs-row").first();
  // Name, game state, score, projection and the line the score was made of —
  // all of it, without being asked for any of it.
  await expect(first.locator(".pbadge__name").first()).toHaveText("P. Mahomes");
  await expect(first.locator(".sb__mark").first()).toHaveText(/FINAL|LIVE|BYE|VS|@/i);
  await expect(first.locator(".sb__vs-pts b").first()).toHaveText(/^\d+\.\d$/);
  await expect(first.locator(".sb__vs-pts span").first()).toHaveText(/^\d+\.\d$/);
  await expect(first.locator(".sb__box").first()).toHaveText(/\d+\/\d+, \d+ YD/);

  // Both sides of every slot that has a man in it, on every row.
  await expect(page.locator(".sb__vs-row .sb__box")).toHaveCount(18);
});

test("the player's own page is one tap away", async ({ page }) => {
  await page.goto("/preview/matchup");
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

test("the score never leaves the screen", async ({ page }) => {
  await page.goto("/preview/matchup");

  const pager = page.locator(".mpager");
  const before = await pager.boundingBox();
  await page.locator(".sb__vs-row").nth(7).scrollIntoViewIfNeeded();
  const after = await pager.boundingBox();

  // Sticky, and in the same place: it is the one bar that answers "which game
  // is this and what is the score", so it holds still whether you are at the
  // top of the header or eight rows into the lineup.
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  await expect(pager.locator(".mpager__side").first()).toContainText(/\d+\.\d/);
});

test("the bench is there, and out of the way", async ({ page }) => {
  await page.goto("/preview/matchup");

  const toggle = page.getByRole("button", { name: /^Bench/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // The count is on the closed control, because "Bench" alone does not say
  // whether opening it is worth the tap.
  await expect(toggle).toContainText("3 · 2");
  await expect(page.locator(".sb__vs-row[data-bench]")).toHaveCount(0);

  await toggle.click();
  // Three against two: one side is a man short, and the rows must not invent
  // a pairing to fill the gap.
  await expect(page.locator(".sb__vs-row[data-bench]")).toHaveCount(3);
  await expect(page.locator(".sb__vs-row[data-bench]").last().locator(".sb__vs-cell"))
    .toHaveCount(2);
  // A bench row carries its own position, since there is no shared slot pill.
  await expect(page.locator(".sb__vs-row[data-bench] .sb__vs-pos").first()).toHaveText("RB");
});
