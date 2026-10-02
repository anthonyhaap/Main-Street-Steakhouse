import { expect, test } from "@playwright/test";

/**
 * Steakhouse Sunday.
 *
 * The live page needs a session and an afternoon of real football, so the
 * fixture at /preview/sunday is what a test can hold still: one invented week
 * with a coherent NFL slate, and a switch that runs it from Sunday morning to
 * Tuesday. The assertions are the things the page exists to say — which game
 * to watch, who is in the red zone, which table is close — and that it keeps
 * saying them when the provider goes quiet.
 */

const stage = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();

test("the page changes personality across the day", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview/sunday");
  const sun = page.locator(".sun");

  await stage(page, "Sunday morning");
  await expect(sun).toHaveAttribute("data-phase", "pre");
  await expect(page.locator(".sun-live")).toHaveText("Pre-game");
  await expect(page.locator(".sun-feat__label b")).toContainText("Game of the week");

  await stage(page, "One o'clock window");
  await expect(sun).toHaveAttribute("data-phase", "live");
  await expect(page.locator(".sun-live")).toHaveText("Live");
  await expect(page.locator(".sun-feat__label b")).toContainText("Game to watch");

  await stage(page, "Tuesday");
  await expect(sun).toHaveAttribute("data-phase", "final");
  await expect(page.getByRole("heading", { name: /Sunday at the Steakhouse/ }).first()).toBeVisible();
  await expect(page.locator(".sun-tile h3", { hasText: "Highest score" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the red zone names our players and the close game is lifted", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");

  // KC is inside the Denver nine; four of ours are Chiefs. The kicker is not
  // named — he scores from the thirty as happily as from the nine.
  const rz = page.locator(".sun-rz");
  await expect(rz.locator(".sun-rz__row")).toHaveCount(4);
  await expect(rz).toContainText("Patrick Mahomes");
  await expect(rz).not.toContainText("Harrison Butker");
  await expect(rz).toContainText("3rd & 4 at DEN 9");

  // Anthony and Marcus are inside five with the four o'clocks in the fourth.
  const close = page.locator("[data-panel='close']");
  if (await close.isHidden()) await page.getByRole("button", { name: /^Matchups/ }).last().click();
  await expect(close.locator(".sun-close__card")).toHaveCount(1);
  await expect(close).toContainText("Difference 3.30");

  // The close game is lifted; the featured slot, though, belongs for a few
  // minutes to the Steakhouse moment — Lou retaking the lead late.
  await expect(page.locator(".sun-feat__label b")).toContainText("Steakhouse moment");
  await expect(page.locator(".sun-feat .sun-score")).toContainText(/Lou/i);
  await expect(page.locator(".sun-feat .sun-score")).toContainText(/Gus/i);
});

test("a touchdown says who it helped, by how much, and what it did to the game", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");

  const td = page.locator(".sun-event[data-kind='touchdown']", { hasText: "Puka Nacua" });
  await expect(td).toBeVisible();
  await expect(td).toContainText("40+ yard receiving touchdown");
  await expect(td.locator(".sun-event__pts")).toHaveText("+9.1 Marcus");
  const impact = td.locator(".sun-impact");
  await expect(impact).toContainText("Fantasy impact");
  // Before and after, leader first on each line.
  await expect(impact.locator(".sun-impact__row").nth(0)).toContainText(/Before\s*Anthony 130\.6\s*Marcus 118\.2/);
  await expect(impact.locator(".sun-impact__row").nth(1)).toContainText(/After\s*Anthony 130\.6\s*Marcus 127\.3/);

  // The Steakhouse moment carries its level, so it is the loudest card.
  await expect(page.locator(".sun-event[data-level='4']")).toContainText("Lou takes the lead over Gus");
});

test("the feed keeps the quiet plays behind a switch, and keeps the day after it ends", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "One o'clock window");
  const feed = page.locator(".sun-evfeed");
  await expect(feed.locator(".sun-event[data-level='1']")).toHaveCount(0);
  await feed.getByRole("button", { name: /Everything/ }).click();
  await expect(feed.locator(".sun-event[data-level='1']")).toContainText("Ja'Marr Chase");
  // No moment in the early window: the featured slot is the ranked game.
  await expect(page.locator(".sun-feat__label b")).toContainText("Game to watch");

  // Tuesday: every final is there, and so is Sunday afternoon.
  await stage(page, "Tuesday");
  await expect(page.locator(".sun-evfeed .sun-event[data-kind='touchdown']", { hasText: "Puka Nacua" })).toBeVisible();
  await expect(page.locator(".sun-evfeed .sun-event[data-kind='final']", { hasText: "Vic beats Sal" })).toBeVisible();
});

test("a feed card opens its matchup", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  await page.locator(".sun-event[data-kind='touchdown']", { hasText: "Puka Nacua" })
    .getByRole("button", { name: "View matchup" }).click();
  await expect(page.locator(".sun-feat__label b")).toHaveText("Your pick");
  await expect(page.locator(".sun-feat .sun-team__who").nth(1)).toHaveText(/Marcus/i);
});

test("the win probability is written as well as drawn", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  const nums = page.locator(".sun-feat .sun-odds__nums span");
  await expect(nums).toHaveCount(2);
  for (const t of await nums.allTextContents()) expect(t).toMatch(/^(<1%|>99%|\d{1,3}%)$/);
  await expect(page.locator(".sun-feat .sun-odds__bar")).toHaveAttribute("aria-label", /%.*%/);
});

test("picking a table features it, and an NFL game shows our players in it", async ({ page }, info) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");

  if (info.project.name === "mobile") await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: /^Matchups/ }).click();
  await page.getByRole("button", { name: "Vic versus Sal" }).click();
  await expect(page.locator(".sun-feat__label b")).toHaveText("Your pick");
  await expect(page.locator(".sun-feat .sun-team__who").first()).toHaveText(/Vic/i);

  if (info.project.name === "mobile") await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: "NFL" }).click();
  await page.getByRole("button", { name: /^KC at DEN/ }).click();
  const game = page.locator(".sun-game[data-open='true']");
  await expect(game).toContainText("fantasy players involved");
  await expect(game.locator(".sun-game__p")).toHaveCount(10);
});

test("a quiet provider keeps the board and says so", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  await expect(page.locator(".sun-delay")).toHaveCount(0);
  await stage(page, "Provider down");
  await expect(page.locator(".sun-delay")).toContainText("Live stats temporarily delayed");
  await expect(page.locator(".sun-card")).toHaveCount(6);
});

test("the ticker crawls, holds still for reduced motion, and every line is a way in", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  // It moves, and the copy that makes the loop seamless is hidden from a
  // screen reader and from the tab order.
  const ticker = page.locator(".sun-ticker");
  await expect(ticker).toHaveAttribute("data-motion", "crawl");
  await expect(ticker.locator(".sun-ticker__list[data-copy]")).toHaveAttribute("aria-hidden", "true");
  await expect(ticker.locator(".sun-ticker__list[data-copy] .sun-ticker__item").first()).toHaveAttribute("tabindex", "-1");

  // Reduced motion: no crawl, no copy, one swipeable strip.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(ticker).toHaveAttribute("data-motion", "still");
  await expect(ticker.locator(".sun-ticker__list")).toHaveCount(1);
  const item = ticker.locator(".sun-ticker__item", { hasText: /CLOSE GAME|UPSET WATCH|RED ZONE/ }).first();
  await item.click();
  await expect(page.locator("#sun-featured")).toBeInViewport();
});

test("Watch NFL RedZone links out and embeds nothing", async ({ page }) => {
  await page.goto("/preview/sunday");
  const a = page.locator(".sun a[href*='nfl.com']").first();
  await expect(a).toHaveAttribute("target", "_blank");
  await expect(a).toHaveAttribute("rel", /noopener/);
  await expect(page.locator(".sun iframe, .sun video")).toHaveCount(0);
});

test("the game center is one tap from any screen", async ({ page }, info) => {
  await page.goto("/preview/tonight");
  if (info.project.name === "mobile") {
    // A phone: a tab of its own, beside Matchups and Chat, never behind More.
    const bar = page.locator(".tabbar");
    const gc = bar.getByRole("link", { name: /Game Center/ });
    await expect(gc).toBeVisible();
    await expect(gc).toHaveAttribute("href", "/sunday");
    await expect(bar.getByRole("link", { name: /Matchups/ })).toHaveAttribute("href", "/matchups");
    await expect(bar.getByRole("link", { name: /Chat/ })).toHaveAttribute("href", "/chat");
    expect((await gc.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Nothing that left the bar is lost: More has My Team and Standings.
    await bar.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "My Team" })).toHaveAttribute("href", "/team");
    await expect(page.getByRole("dialog").getByRole("link", { name: "Standings" })).toHaveAttribute("href", "/standings");
  } else {
    // A laptop: the nav has no room for it, so it is in the League menu.
    await page.getByRole("button", { name: "League" }).click();
    await expect(page.getByRole("link", { name: "Game Center" })).toHaveAttribute("href", "/sunday");
  }
});

test("on a desktop the chat takes a column and covers nothing", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "the phone has its own chat tab");
  const apart = (a: { x: number; width: number }, b: { x: number; width: number }) =>
    a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1;
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/preview/sunday");
    await page.locator(".sun-tabs[data-for='desk']").getByRole("button", { name: "Chat" }).click();
    const chat = (await page.locator(".sun-drawer").boundingBox())!;
    const main = (await page.locator(".sun-main").boundingBox())!;
    expect(apart(chat, main), `${width}: chat over the board`).toBe(true);
    const rail = page.locator(".sun-rail");
    if (await rail.isVisible()) expect(apart(chat, (await rail.boundingBox())!), `${width}: chat over the rail`).toBe(true);
    // And the featured panel stays inside its own column.
    const feat = (await page.locator(".sun-feat").boundingBox())!;
    expect(feat.x + feat.width).toBeLessThanOrEqual(main.x + main.width + 1);
  }
});

/* ---------------------------------------------------------------- phase 3 -- */

test("one tap reacts to a moment, and a second tap takes it back", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  const card = page.locator(".sun-event[data-level='4']", { hasText: "Lou takes the lead over Gus" });
  const laugh = card.locator(".sun-react__btn", { hasText: "😂" });
  await expect(laugh).toHaveAttribute("aria-label", "😂 4");
  await laugh.click();
  await expect(laugh).toHaveAttribute("aria-label", "😂 5");
  await expect(laugh).toHaveAttribute("aria-pressed", "true");
  await laugh.click();
  await expect(laugh).toHaveAttribute("aria-label", "😂 4");
  // All six, the 😡 included, and no chat had to open for any of it.
  await expect(card.locator(".sun-react__btn")).toHaveCount(6);
  await expect(page.locator(".sun-drawer")).toHaveCount(0);
});

test("Talk shit opens the chat with the moment attached", async ({ page }, info) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  const td = page.locator(".sun-event[data-kind='touchdown']", { hasText: "Puka Nacua" });
  await td.getByRole("button", { name: /Talk shit/ }).click();

  const panel = info.project.name === "mobile" ? page.locator("[data-panel='chat']") : page.locator(".sun-drawer");
  const ctx = panel.locator(".sun-chat__ctx");
  await expect(ctx).toHaveText(/🏈 Puka Nacua — 40\+ yard receiving touchdown, \+9\.1 Marcus\./);
  const input = panel.getByRole("textbox", { name: "Say something about this moment" });
  await expect(input).toBeFocused();
  await input.fill("no way that counts");
  await input.press("Enter");

  // The line goes out with the moment above it, the chip clears, and the
  // card counts the talk.
  // Newest at the bottom, the way a chat reads.
  await expect(panel.locator(".sun-msg").last()).toContainText("Puka Nacua");
  await expect(panel.locator(".sun-msg").last()).toContainText("no way that counts");
  await expect(ctx).toHaveCount(0);

  // Back to the feed — below 1400px the chat takes the rail's place, and on a
  // phone it is its own tab — where the card now counts the talk.
  if (info.project.name === "mobile") {
    await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: /^Live/ }).click();
  } else {
    await page.getByRole("button", { name: "Close chat" }).click();
  }
  await expect(td.getByRole("button", { name: /Talk shit · 1/ })).toBeVisible();
});

test("the feed carries what the league's people did between the football", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "One o'clock window");
  const feed = page.locator(".sun-evfeed");
  await expect(feed.locator(".sun-activity[data-verb='accepted']")).toContainText("Dev accepted Ray's challenge: Dev outscores Ray");
  await expect(feed.locator(".sun-activity[data-kind='chat']", { hasText: "absolute fraud" })).toContainText("7 reactions");

  // A Talk-shit line quotes only what was said; its moment is its own card.
  await stage(page, "Late window");
  const talk = page.locator(".sun-activity[data-kind='chat']", { hasText: "there's no way" });
  await expect(talk.locator(".sun-activity__q")).toHaveText("there's no way");

  // Tuesday: the challenge settled.
  await stage(page, "Tuesday");
  await expect(page.locator(".sun-activity[data-verb='settled']")).toContainText("Dev won the challenge");
});

test("the ticker carries the room", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "One o'clock window");
  const ticker = page.locator(".sun-ticker");
  const seen = await ticker.locator(".sun-ticker__list:not([data-copy]) .sun-ticker__item").allTextContents();
  expect(seen.join(" | ")).toContain("DEV ACCEPTED RAY'S CHALLENGE");
  expect(seen.join(" | ")).toContain("💬 3 NEW CHAT MESSAGES");
});

/* ------------------------------------------------------- phase 4: intel -- */

test("the storylines say only what the league's data supports", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Sunday morning");
  const stories = page.locator("[data-panel='stories']");
  await expect(stories).toContainText("pull off the upset?");

  await stage(page, "Late window");
  await expect(stories).toContainText("Ray is chasing a fourth straight win.");
  await expect(stories).toContainText("Anthony has beaten Marcus 3 straight times.");
  await expect(stories).toContainText("Lou is pulling off the upset");
  // A storyline opens the table it is about.
  await stories.getByRole("button", { name: /Anthony has beaten Marcus/ }).click();
  await expect(page.locator(".sun-feat .sun-team__who").first()).toContainText(/Anthony|Marcus/);

  // Once it is over, nobody is chasing anything.
  await stage(page, "Tuesday");
  await expect(page.locator("body")).not.toContainText("is chasing a fourth straight win");
});

test("What do I need? gives the gap, who is left, and what they score for", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  const need = page.locator("[data-panel='need']");
  await expect(need).toContainText("About 17.3 more to pass Dev's projected 90.1");
  await expect(need.locator("li", { hasText: "Trey McBride" })).toContainText("a TD +6.0");
  await expect(need.locator("li", { hasText: "Trey McBride" })).toContainText("10 receiving yds +1.0");
  // Never a promise while the other side still has men to play.
  await expect(need).toContainText("not a guarantee");

  // Nothing to need before kickoff, or after the whistle.
  await stage(page, "Sunday morning");
  await expect(need).toHaveCount(0);
  await stage(page, "Tuesday");
  await expect(need).toHaveCount(0);
});

test("every manager has a status card, yours first", async ({ page }, info) => {
  await page.goto("/preview/sunday");
  await stage(page, "Late window");
  if (info.project.name === "mobile") {
    await page.locator(".sun-tabs[data-for='phone']").getByRole("button", { name: /Matchups/ }).click();
  } else {
    await page.locator(".sun-tabs[data-for='desk']").getByRole("button", { name: "Matchups" }).click();
  }
  const room = page.locator("[data-panel='room']");
  await expect(room.locator(".sun-mgr")).toHaveCount(12);
  await expect(room.locator(".sun-mgr").first()).toHaveAttribute("data-mine", "true");
  await expect(room.locator(".sun-mgr").first()).toContainText("Ray · You");
  await expect(room.locator(".sun-mgr").first()).toContainText("Needs about 17.3 more");
  await expect(room.locator(".sun-mgr .sun-mood").first()).toBeVisible();

  // Before kickoff there is no mood to have.
  await stage(page, "Sunday morning");
  await expect(room).toHaveCount(0);
});

test("the commissioner's weights decide the featured table, and are bounded", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "the why line is the desktop panel's; the dials are tested once");
  await page.goto("/preview/sunday");
  await stage(page, "Sunday morning");
  await expect(page.locator(".sun-why")).toContainText("Featured for:");

  const tune = page.locator("[data-panel='tune']");
  await tune.locator("summary").click();
  await tune.getByLabel("Lead change").fill("9000");
  await tune.getByRole("button", { name: "Save weights" }).click();
  await expect(tune.getByRole("status")).toHaveText("lead_change must be a whole number from 0 to 100");

  // Make history the only thing that matters: a rivalry gets the slot.
  await tune.getByLabel("Lead change").fill("35");
  await tune.getByLabel("Rivalry").fill("100");
  await tune.getByRole("button", { name: "Save weights" }).click();
  await expect(tune.getByRole("status")).toContainText("Saved");
  await expect(page.locator(".sun-why")).toContainText("rivalry");
});

/* ----------------------------------------------------- phase 5: history -- */

test("Tuesday's recap keeps the whole day", async ({ page }) => {
  await page.goto("/preview/sunday");
  await stage(page, "Tuesday");
  const recap = page.locator("[data-panel='recap']");
  await expect(recap.locator(".sun-tile", { hasText: "Biggest comeback" })).toContainText("from 8.9 down");
  await expect(recap.locator(".sun-tile", { hasText: "Biggest fantasy play" })).toContainText("Puka Nacua");
  await expect(recap.locator(".sun-tile", { hasText: "Most reacted-to moment" })).toContainText("Lou takes the lead over Gus");
  await expect(recap.locator(".sun-recap__quote")).toContainText("absolute fraud");
  await expect(recap.locator(".sun-recap__quote")).toContainText("Sal · 7 reactions");
  // A settled bet says who won; an open one does not pretend to.
  await expect(recap.locator(".sun-recap__list li", { hasText: "Dev outscores Ray" })).toContainText("Dev won");
  await expect(recap.locator(".sun-recap__list li", { hasText: "Packers -3.5" })).toContainText("still to settle");
  await expect(recap.locator(".sun-recap__list li", { hasText: "Gus v Lou" })).toContainText("Lou in front · 103.6–97.1");
  // And the feed is still there to scroll back through.
  await expect(page.locator(".sun-evfeed")).toContainText("Lou takes the lead over Gus");
});

test("the wall keeps Sunday: moments, records and every manager's line", async ({ page }) => {
  await page.goto("/preview/history");
  const wall = page.locator(".sunday-wall");
  await expect(wall).toContainText("27 Sundays on record");
  const moments = wall.locator(".card", { hasText: "Memorable moments" });
  await expect(moments.locator(".ledger__row").first()).toContainText("Lou takes the lead over Gus");
  // This season's moment opens its Sunday; an older one is a line on the wall.
  await expect(moments.getByRole("link", { name: /Lou takes the lead over Gus/ })).toHaveAttribute("href", "/sunday?week=12");
  await expect(moments.getByRole("link", { name: /Vic sets the season high/ })).toHaveCount(0);
  await expect(wall.locator(".card", { hasText: "Sunday records" })).toContainText("Biggest comeback: Anthony over Marcus");
  await expect(wall.locator(".sunday-lines tbody tr")).toHaveCount(12);
});
