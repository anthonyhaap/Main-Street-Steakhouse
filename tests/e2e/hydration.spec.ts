import { expect, test } from "@playwright/test";

/**
 * A prerendered page has to hydrate whenever it is opened.
 *
 * Every /preview/* page is rendered once at build time and again in the
 * browser. A fixture that takes a date from the clock and prints it as a day
 * or a time writes different text on each side once enough time has passed
 * between them — and React refuses the page (#418). A CI run that built before
 * midnight UTC and tested after it failed exactly so on /preview/challenges.
 *
 * So each preview is opened with the browser's clock a day and a half ahead of
 * the build, and must come up without an error. Relative times ("42m ago")
 * pass, because both sides count them from their own now; printed dates must
 * be fixed instants.
 */

const PAGES = [
  "/preview", "/preview/admin", "/preview/challenges", "/preview/chat", "/preview/draft", "/preview/history",
  "/preview/league-feed", "/preview/ledger", "/preview/matchup", "/preview/matchups", "/preview/notifications",
  "/preview/players", "/preview/recap", "/preview/standings", "/preview/sunday", "/preview/team",
  "/preview/tonight", "/preview/trades", "/preview/waivers",
];

for (const path of PAGES) {
  test(`${path} hydrates a day and a half after it was built`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: Date.now() + 36 * 3600_000 });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(errors.filter((m) => /#418|#423|#425|hydrat/i.test(m)), path).toEqual([]);
  });
}

// A time printed on the server has to be the same characters in every browser.
// ICU's narrow no-break space before "PM" is kept by Node and dropped by newer
// Chromiums, so a prerendered "9:34 PM ET" hydrated as different text in CI.
test("a prerendered clock time carries no engine-specific space", async ({ request }) => {
  const html = await (await request.get("/preview/recap")).text();
  expect(html).toContain("PM ET");
  expect(html).not.toMatch(/[  ][AP]M/);
});
