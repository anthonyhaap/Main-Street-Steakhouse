import { expect, test } from "@playwright/test";

/**
 * Head to head.
 *
 * The real screen needs a session, two managers with Venmo handles and a week
 * that has been decided, so /preview/challenges is what a test can hold still.
 * The assertions are the slips: who is offered what, and that the Venmo link
 * already carries the amount and the right handle, because that is the whole
 * difference between "settle up" and a button that opens somebody's profile.
 */

test("the desk is behind the session", async ({ page }) => {
  await page.goto("/challenges");
  await expect(page).toHaveURL(/\/login/);
});

test("the loser gets a payment already written out", async ({ page }) => {
  await page.goto("/preview/challenges");
  const slip = page.locator("#challenge-c1");
  const pay = slip.getByRole("link", { name: "Pay $20 in Venmo" });
  await expect(pay).toBeVisible();
  const href = await pay.getAttribute("href");
  expect(href).toContain("venmo.com/dave-pays?");
  expect(href).toContain("txn=pay");
  expect(href).toContain("amount=20.00");
  expect(href).toContain("Week+5");
  await expect(slip.getByRole("button", { name: "I paid" })).toBeVisible();
  // Nothing a winner would press.
  await expect(slip.getByRole("button", { name: "Confirm received" })).toHaveCount(0);
});

test("the winner gets the request, and waits", async ({ page }) => {
  await page.goto("/preview/challenges");
  const slip = page.locator("#challenge-c2");
  const ask = slip.getByRole("link", { name: "Request $10 in Venmo" });
  await expect(ask).toBeVisible();
  const href = await ask.getAttribute("href");
  expect(href).toContain("venmo.com/mike-pays?");
  expect(href).toContain("txn=charge");
  expect(href).toContain("amount=10.00");
  await expect(slip.getByText("Waiting on Mike.")).toBeVisible();
  await expect(slip.getByRole("button", { name: "I paid" })).toHaveCount(0);
});

test("a payment waits on the winner's word alone", async ({ page }) => {
  await page.goto("/preview/challenges");
  const slip = page.locator("#challenge-c3");
  await expect(slip.getByText("Paid, unconfirmed")).toBeVisible();
  await expect(slip.getByRole("button", { name: "Confirm received" })).toBeVisible();
  await expect(slip.getByText(/Reference: Venmo: Week 4/)).toBeVisible();
  await slip.getByRole("button", { name: "Confirm received" }).click();
  await expect(page.getByTestId("log")).toHaveText("confirmed c3");
});

test("only the manager challenged can answer", async ({ page }) => {
  await page.goto("/preview/challenges");
  const shot = page.locator("#challenge-c4");
  await expect(shot.getByRole("button", { name: "Accept & lock" })).toBeVisible();
  await expect(shot.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(shot.locator(".bet__facts").getByText("$5")).toBeVisible();
});

test("a settled bet and a tie offer nothing more", async ({ page }) => {
  await page.goto("/preview/challenges");
  // A phone folds the settled pile behind its count.
  const settled = page.getByRole("region", { name: "Settled" });
  const show = settled.getByRole("button", { name: /Show/ });
  if (await show.isVisible()) await show.click();
  for (const id of ["c5", "c6"]) {
    const card = page.locator(`#challenge-${id}`);
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.getByRole("link")).toHaveCount(0);
  }
  await expect(page.locator("#challenge-c5").getByText("Priya won")).toBeVisible();
  await expect(page.locator("#challenge-c6").getByText("Void")).toBeVisible();
});

test("an overdue slip says so in words", async ({ page }) => {
  await page.goto("/preview/challenges");
  await expect(page.locator("#challenge-c8").getByText("Overdue")).toBeVisible();
  await expect(page.locator("#challenge-c1").getByText("Overdue")).toHaveCount(0);
});

test("the ruling is the commissioner's alone", async ({ page }) => {
  await page.goto("/preview/challenges");
  const bet = page.locator("#challenge-c7");
  await expect(bet.getByRole("button", { name: /Award/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Commissioner" }).click();
  await expect(bet.getByRole("button", { name: "Award Dave" })).toBeVisible();
  await expect(bet.getByRole("button", { name: "Award Mike" })).toBeVisible();
});

test("a spread bet shows both sides of the line", async ({ page }) => {
  await page.goto("/preview/challenges");
  const shot = page.locator("#challenge-c9");
  const sides = shot.getByTestId("spread");
  await expect(sides.getByText("KC \u22123")).toBeVisible();
  await expect(sides.getByText("BUF +3")).toBeVisible();
  await expect(sides.getByText(/Kicks off .* It locks then\./)).toBeVisible();
  await expect(shot.getByRole("button", { name: "Accept & lock" })).toBeVisible();
  await expect(shot.locator(".bet__facts").getByText("$20")).toBeVisible();
});

test("a spread bet in play says who is covering", async ({ page }) => {
  await page.goto("/preview/challenges");
  const bet = page.locator("#challenge-c10");
  // BUF +2.5 down four: the line is not enough, so Dave's MIA -2.5 is covering.
  await expect(bet.getByText("Q3 8:14 · Dave covering")).toBeVisible();
  await expect(bet.locator('.bet__side[data-covering="true"]')).toContainText("MIA \u22122.5");
  await expect(bet.locator(".bet__side").filter({ hasText: "BUF +2.5" })).not.toHaveAttribute("data-covering", "true");
});

test("a spread bet that covered pays like any other", async ({ page }) => {
  await page.goto("/preview/challenges");
  const bet = page.locator("#challenge-c11");
  await expect(bet.getByText("Final · You covered")).toBeVisible();
  const ask = bet.getByRole("link", { name: "Request $10 in Venmo" });
  const href = await ask.getAttribute("href");
  expect(href).toContain("venmo.com/mike-pays?");
  expect(href).toContain("Week+6");
});

test("a push lands on its card", async ({ page }) => {
  await page.goto("/preview/challenges#c3");
  await expect(page.locator("#challenge-c3")).toHaveAttribute("data-target", "true");
  await expect(page.locator("#challenge-c1")).not.toHaveAttribute("data-target", "true");
});

test("the cards fit the phone", async ({ page }) => {
  await page.goto("/preview/challenges");
  await expect(page.locator("#challenge-c8")).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});

test("the preview hydrates the same the day after it was built", async ({ page }) => {
  // The page is prerendered at build time and rendered again in the browser.
  // A fixture dated from the clock prints a different day once midnight falls
  // between the two, and React refuses the page (#418) — which is how a CI run
  // straddling midnight UTC failed. Put the browser a day and a half ahead of
  // the build and the two renders must still agree.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: Date.now() + 36 * 3600_000 });
  await page.goto("/preview/challenges");
  await expect(page.locator("#challenge-c1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

/**
 * The bets that need you come first. Accepting a shot, paying a slip and
 * confirming a payment are the three things a manager has to do on this page,
 * and they used to be scattered through a grid sorted by when the bet was
 * made. Settled bets go last, and on a phone they fold away.
 */
test("the bets waiting on you come first", async ({ page }, info) => {
  await page.goto("/preview/challenges");
  const yours = page.getByRole("region", { name: "Waiting on you" });
  // c1: you lost and owe. c3: you won and are asked to confirm. c4 and c9:
  // you were challenged. c8: you lost and the slip is overdue.
  for (const id of ["c1", "c3", "c4", "c8", "c9"]) {
    await expect(yours.locator(`#challenge-${id}`)).toHaveCount(1);
  }
  // You won c2: the request is yours to send but nobody is waiting on you.
  await expect(page.getByRole("region", { name: "In play" }).locator("#challenge-c2")).toHaveCount(1);
  const settled = page.getByRole("region", { name: "Settled" });
  await expect(settled.locator("#challenge-c5")).toHaveCount(1);
  if (info.project.name === "mobile") {
    await expect(settled.locator("#challenge-c5")).toBeHidden();
    await settled.getByRole("button", { name: /Show/ }).click();
    await expect(settled.locator("#challenge-c5")).toBeVisible();
  }
});
