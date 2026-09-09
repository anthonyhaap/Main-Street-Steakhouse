import { expect, test } from "@playwright/test";

/**
 * The manager's screens are behind the session.
 *
 * The NFL wire used to be a route handler proxying ESPN, and the test here kept
 * it from becoming an open relay. It is now a pair of tables loaded by pg_cron,
 * so the guard moved with it: `nfl_news` and `nfl_injuries` are RLS'd to league
 * members, and the pages that read them redirect when signed out.
 */

test("the team desk requires a session", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?next=%2Fteam|\/login\?next=\/team/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("a player page requires a session", async ({ page }) => {
  await page.goto("/player/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

/**
 * The lineup coach, against the fixture.
 *
 * The real desk needs a session and a live week; /preview/team is the same
 * components over a roster that does not move, which is the only way to assert
 * on a recommendation. The fixture is built so exactly one swap is right:
 * Nacua is questionable with an ankle and Chase, on the bench, is not.
 *
 * The assertions are the sentences, because on this screen the sentences are
 * the product. A lineup change a manager cannot follow is one he will not make.
 */
test("the coach proposes a lineup, explains it, and applies it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/team");

  // What is on the table is on the button, before anything is opened.
  const open = page.getByRole("button", { name: /Best lineup/ });
  await expect(open).toContainText(/\+\d+\.\d/);
  await open.click();

  const coach = page.getByRole("dialog", { name: "Best lineup" });
  await expect(coach.getByRole("heading", { name: "The best lineup we can see" })).toBeVisible();

  // The swap, and the reason for both halves of it.
  await expect(coach.getByText("Ja'Marr Chase")).toBeVisible();
  await expect(coach.getByText("Puka Nacua")).toBeVisible();
  await expect(coach.getByText(/Questionable is a real risk/)).toBeVisible();

  // The forecast is read per stadium, and says so.
  await expect(coach.getByText(/Forecasts from Open-Meteo/)).toBeVisible();
  await expect(coach.getByText("DET · INDOORS")).toBeVisible();

  await coach.getByRole("button", { name: "Set this lineup" }).click();
  await expect(coach).toBeHidden();

  // Chase started, Nacua sat — and there is nothing left to win.
  await expect(page.locator(".lineup").first()).toContainText("Ja'Marr Chase");
  await open.click();
  await expect(page.getByRole("heading", { name: "You are already there" })).toBeVisible();
  await expect(page.getByText(/Nothing on the wire, the schedule or the forecast beats/)).toBeVisible();

  expect(errors).toEqual([]);
});

/**
 * Another manager's desk, against the same fixture.
 *
 * Every manager can open every other manager's team. What they get is the
 * whole desk — the lineup, the form, the wire read against that roster, the
 * coach's opinion — and no way to change any of it. The test is the absence:
 * no move buttons, no edit, no "set this lineup", no notification settings,
 * with the reads still on the page around the gaps.
 */
test("another manager's desk can be read and not touched", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // The owner's desk, for the contrast: the arrows are there.
  await page.goto("/preview/team");
  await expect(page.getByRole("button", { name: /^Move / }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What changed for you" })).toBeVisible();

  await page.goto("/preview/team?as=visitor");
  await expect(page.getByText("Viewing")).toBeVisible();

  // The roster is all there to read, and none of it can be picked up.
  await expect(page.locator(".lineup").first()).toContainText("Patrick Mahomes");
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit team" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Notifications" })).toHaveCount(0);

  // The wire is read against *their* roster, and says so.
  await expect(page.getByRole("heading", { name: /^What changed for / })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What changed for you" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Their players" })).toBeVisible();

  // The coach still has an opinion; it just cannot act on it.
  await page.getByRole("button", { name: /Best lineup/ }).click();
  const coach = page.getByRole("dialog", { name: "Best lineup" });
  await expect(coach.getByText("Ja'Marr Chase")).toBeVisible();
  await expect(coach.getByText("Their lineup now")).toBeVisible();
  await expect(coach.getByRole("button", { name: "Set this lineup" })).toHaveCount(0);
  await coach.getByRole("button", { name: "Leave it alone" }).click();
  await expect(coach).toBeHidden();

  expect(errors).toEqual([]);
});

/**
 * The standings are the front door to the other desks: every team's name is a
 * link to `/team?id=`, and your own is plain `/team`.
 */
test("the standings link every team to its desk", async ({ page }) => {
  await page.goto("/preview/standings");
  const links = page.locator("table a.tlink");
  await expect(links).toHaveCount(12);
  // The fixture signs in as t4: that row goes home, the other eleven go visiting.
  await expect(page.locator('table a.tlink[href="/team"]')).toHaveCount(1);
  await expect(page.locator('table a.tlink[href^="/team?id=t"]')).toHaveCount(11);
});
