import { expect, test, type Page } from "@playwright/test";

/**
 * Game Day 2.0.
 *
 * The game center from the reader's chair: their matchup first, then what
 * just happened, then the league. `/preview/sunday` holds one invented week
 * still at five hours of it and lets the test sit in any manager's seat, which
 * is how the brief's scenarios are reached without inventing more Sundays:
 *
 *   A  nothing kicked              Sunday morning
 *   B  several games live          One o'clock window
 *   C  cruising                    Late window, Tom's seat
 *   D  getting crushed             Late window, Nate's seat
 *   E  within two                  Monday night, Lou's seat (0.3)
 *   F  a lead change               Late window, Lou's seat
 *   G  several tables move at once Late window: two lead changes and a squeeze
 *   H  Sunday all final            Monday night
 *   I  a Monday man left           Monday night, Ray's seat (Jefferson)
 *   J  the NFL feed fails          the NFL-feed-down switch
 */

const click = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).first().click();
const go = async (page: Page, stage: string, seat = "Seat: Ray") => {
  await page.goto("/preview/sunday");
  await click(page, stage);
  await click(page, seat);
};

test("my matchup is the first thing on the page, and it says who is winning", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await go(page, "Late window");
  const mine = page.locator("#sun-mine");
  await expect(mine).toBeVisible();
  await expect(mine.locator(".gd-side").first()).toContainText("Ray");
  await expect(mine.locator(".gd-side").first()).toContainText("72.8");
  await expect(mine.locator(".gd-side").first()).toContainText(/Losing · \d{1,2}%/);
  await expect(mine.locator(".gd-side").last()).toContainText(/Winning · \d{1,2}%/);
  await expect(mine.locator(".gd-side").first()).toContainText("3 remaining");
  await expect(mine.getByRole("link", { name: /View live matchup/ })).toHaveAttribute("href", "/matchups/gm1?week=12");
  // Above the tabs and above the featured "game to watch", which is never
  // your own game twice.
  const hero = (await mine.boundingBox())!;
  const tabs = (await page.locator(".sun-tabs:visible").first().boundingBox())!;
  expect(hero.y).toBeLessThan(tabs.y);
  expect((await page.locator(".sun-feat .sun-team__who").allTextContents()).join(" ")).not.toMatch(/Ray/i);
  expect(errors).toEqual([]);
});

test("C and D: cruising and getting crushed read differently", async ({ page }) => {
  await go(page, "Late window", "Seat: Tom (cruising)");
  await expect(page.locator("#sun-mine .gd-side").first()).toHaveAttribute("data-tone", "up");
  await expect(page.locator("#sun-mine .gd-side").first()).toContainText("Winning");
  await click(page, "Seat: Nate (getting crushed)");
  await expect(page.locator("#sun-mine .gd-side").first()).toHaveAttribute("data-tone", "down");
  await expect(page.locator("#sun-mine .gd-side").first()).toContainText("Losing");
});

test("F: a lead that just changed hands is the matchup moment", async ({ page }) => {
  await go(page, "Late window", "Seat: Lou (just took the lead)");
  const m = page.locator("#sun-mine .gd-moment");
  await expect(m).toContainText("Lead change");
  await expect(m).toContainText("Lou takes the lead by 6.5");
});

test("E and I: Monday night — a one-man race, and the man who has to do it", async ({ page }) => {
  await go(page, "Monday night", "Seat: Lou (just took the lead)");
  await expect(page.locator("#sun-mine .gd-moment")).toContainText("Gus takes the lead by 0.3");
  await click(page, "Seat: Ray");
  const m = page.locator("#sun-mine .gd-moment");
  await expect(m).toContainText("Needs 13.9");
  await expect(m).toContainText("Justin Jefferson — MIN");
  // H: every Sunday game is final and the page knows what day it is.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday Game Center");
});

test("A: before kickoff the page says when it starts, from the real slate", async ({ page }) => {
  await go(page, "Sunday morning");
  const next = page.locator(".gd-next");
  await expect(next).toContainText("No games are live right now.");
  await expect(next).toContainText("1:00 PM ET");
  await expect(next).toContainText("Next up: BUF @ MIA");
  await expect(page.locator("#sun-mine .gd-side").first()).toContainText(/Favored|Underdog|Even/);
  // Nothing has happened, so nothing claims to have.
  await expect(page.locator("[data-panel='happened'], [data-panel='pulse']")).toHaveCount(0);
});

test("what just happened is told fantasy-first", async ({ page }) => {
  await go(page, "Late window");
  const td = page.locator(".gd-story[data-kind='touchdown']", { hasText: "Puka Nacua" });
  await expect(td.locator(".gd-story__impact")).toHaveText("+9.1 Marcus");
  await expect(td.locator(".gd-story__line")).toHaveText("Marcus trails Anthony 127.3–130.6.");
  await expect(page.locator(".gd-story[data-kind='tightening']")).toContainText("Marcus cuts Anthony's lead to 3.3");
});

test("G: the league pulse carries several tables moving at once, each once", async ({ page }) => {
  await go(page, "Late window");
  const pulse = page.locator("[data-panel='pulse']");
  await expect(pulse).toContainText("Lou takes the lead over Gus");
  await expect(pulse).toContainText("Vic takes the lead over Sal");
  await expect(pulse).toContainText("Marcus cuts Anthony's lead to 3.3");
  await expect(pulse).toContainText("12th-place Lou is leading 5th-place Gus");
  // The squeeze is told as the event; the board does not say it again.
  await expect(pulse).not.toContainText("Marcus is within 3.3 of Anthony");
  // A pulse line opens its table.
  await pulse.getByRole("button", { name: /Vic takes the lead over Sal/ }).click();
  await expect(page.locator(".sun-feat__label b")).toHaveText("Your pick");
});

test("bench pain is told only once both games are over", async ({ page }) => {
  await go(page, "Late window", "Seat: Nate (getting crushed)");
  await expect(page.locator("body")).not.toContainText("on the bench —");
  await click(page, "Tuesday");
  await expect(page.locator(".sun-ticker")).toContainText("NATE LEFT 21.4 ON THE BENCH");
});

test("J: with the NFL feed down the fantasy board stays and says why", async ({ page }, info) => {
  await go(page, "Late window");
  await click(page, "NFL feed down");
  await expect(page.locator(".sun-delay")).toBeVisible();
  await expect(page.locator("#sun-mine")).toContainText("72.8");
  if (info.project.name === "mobile") await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: "NFL" }).click();
  else await page.locator(".sun-tabs[data-for='desk']").getByRole("button", { name: "NFL games" }).click();
  await expect(page.locator("[data-panel='nfl']")).toContainText("aren't coming through");
});

test("NFL games carry their fantasy relevance", async ({ page }, info) => {
  await go(page, "Late window");
  if (info.project.name === "mobile") await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: "NFL" }).click();
  else await page.locator(".sun-tabs[data-for='desk']").getByRole("button", { name: "NFL games" }).click();
  // Live games first, and the KC game — ten of ours — leads them.
  await expect(page.locator(".sun-game").first()).toContainText("KC");
  await expect(page.locator(".sun-game").first()).toContainText("10 Steakhouse players");
});

test("no matchup this week: the page says so and shows the league", async ({ page }) => {
  await go(page, "Late window", "Seat: No matchup");
  await expect(page.locator("#sun-mine")).toHaveCount(0);
  await expect(page.locator(".gd-noseat")).toBeVisible();
  await expect(page.locator(".sun-feat")).toBeVisible();
});

test("the front page reacts to the day", async ({ page }) => {
  await page.goto("/preview/tonight");
  await click(page, "Thursday");
  const today = page.locator(".today");
  await expect(today).toContainText("Tonight");
  await expect(today).toContainText("You: Puka Nacua");

  await click(page, "Sunday live");
  await expect(page.locator(".today")).toHaveCount(0);
  const live = page.locator(".home-gd");
  await expect(live).toContainText("League pulse");
  await expect(live.getByRole("link", { name: /Open Game Center/ })).toHaveAttribute("href", "/sunday");
});

test("the matchup page has its moment", async ({ page }) => {
  await page.goto("/preview/matchup");
  await click(page, "Monday night");
  const m = page.locator(".mmoment");
  await expect(m).toContainText("Needs 5.9");
  await expect(m).toContainText("Jonathan Taylor — IND");
});

for (const width of [375, 390, 430, 820, 1280]) {
  test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, stage] of [["/preview/sunday", "Late window"], ["/preview/sunday", "Monday night"],
      ["/preview/tonight", "Sunday live"], ["/preview/matchup", "Late window"]] as const) {
      await page.goto(path);
      await click(page, stage);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${path} · ${stage}`).toBeLessThanOrEqual(0);
    }
  });
}

test("the monster-game line follows the commissioner's dial", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "the dials are tested once, on the desktop panel");
  await go(page, "Tuesday");
  const pulse = page.locator("[data-panel='pulse']");
  await expect(pulse).toContainText("Jared Goff has 32.5 for Marcus");
  const tune = page.locator("[data-panel='tune']");
  await tune.locator("summary").click();
  await tune.getByLabel("Monster game").fill("40");
  await tune.getByRole("button", { name: "Save weights" }).click();
  await expect(tune.getByRole("status")).toContainText("Saved");
  await expect(pulse).not.toContainText("Jared Goff");
});

test("the game center offers push under your matchup, once, and means it", async ({ page }) => {
  await go(page, "Late window");
  const offer = page.locator(".gd-push");
  await expect(offer).toContainText("Get buzzed when your matchup swings.");
  await expect(offer).toContainText("not every catch");
  await offer.getByRole("button", { name: "Turn on" }).click();
  await expect(offer).toHaveCount(0);

  // "Not now" is remembered on this device.
  await page.reload();
  await click(page, "Late window");
  await page.locator(".gd-push").getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".gd-push")).toHaveCount(0);
  await page.reload();
  await click(page, "Late window");
  await expect(page.locator(".gd-push")).toHaveCount(0);
});

test("no offer without a matchup of your own", async ({ page }) => {
  await go(page, "Late window", "Seat: No matchup");
  await expect(page.locator(".gd-push")).toHaveCount(0);
});
