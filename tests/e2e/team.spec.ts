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

/**
 * A link to somebody else's desk survives the sign-in. `/team?id=x` is a
 * different page from `/team`, so the query has to ride inside `next` — and
 * only there, not also beside it on the login URL.
 */
test("another manager's desk survives the sign-in", async ({ page }) => {
  await page.goto("/team?id=abc");
  await expect(page).toHaveURL(/\/login\?next=%2Fteam%3Fid%3Dabc$/);
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
 * The doors to the transaction centre, and the deadline that decides which
 * one to use, are on the desk itself.
 *
 * Signing and claiming live under Transactions, which on a phone is behind
 * More; a manager staring at a hole in his lineup should not have to know
 * that. The strip under the hero names when the wire settles and opens
 * straight onto the free agents and the wire — and only on his own desk,
 * because the claim and the deadline are his, not the roster he is visiting.
 */
test("the desk says when waivers settle and opens onto the pool", async ({ page }) => {
  await page.goto("/preview/team");
  const moves = page.getByRole("region", { name: "Roster moves" });
  await expect(moves).toBeVisible();
  // The fixture settles on a Wednesday morning; the words are what matter,
  // the clock is the browser's.
  await expect(moves.getByText(/Waivers settle/)).toBeVisible();
  await expect(moves.getByText(/Wed/)).toBeVisible();
  await expect(moves.getByText(/Claims are blind until then/)).toBeVisible();
  await expect(moves.getByRole("link", { name: "Free agents" }))
    .toHaveAttribute("href", "/transactions?tab=players");
  await expect(moves.getByRole("link", { name: "Waiver wire" }))
    .toHaveAttribute("href", "/transactions?tab=waivers");
  await expect(moves.getByRole("link", { name: "Trades" }))
    .toHaveAttribute("href", "/transactions?tab=trades");

  await page.goto("/preview/team?as=visitor");
  await expect(page.getByText("Viewing")).toBeVisible();
  await expect(page.getByRole("region", { name: "Roster moves" })).toHaveCount(0);
});

/**
 * The standings are the front door to the other desks: every team is a link to
 * `/team?id=`, and your own is plain `/team`.
 *
 * The door is `.tdoor` — the crest, the name and the manager inside one anchor
 * — rather than `.tlink` around the name alone. A name is eight characters of
 * target next to a 28-pixel crest that used to do nothing, and on a phone the
 * difference decided whether the feature was reachable.
 */
test("the standings link every team to its desk", async ({ page }) => {
  await page.goto("/preview/standings");
  const links = page.locator("table a.tdoor");
  await expect(links).toHaveCount(12);
  // The fixture signs in as t4: that row goes home, the other eleven go visiting.
  await expect(page.locator('table a.tdoor[href="/team"]')).toHaveCount(1);
  await expect(page.locator('table a.tdoor[href^="/team?id=t"]')).toHaveCount(11);

  // The crest is inside the door, not beside it.
  const visiting = page.locator('table a.tdoor[href^="/team?id=t"]').first();
  await expect(visiting.locator(".seal")).toHaveCount(1);
  // And the door says what it opens, which the team's name alone does not.
  await expect(visiting).toHaveAttribute("aria-label", /^Open .+'s roster$/);
  await expect(page.locator('table a.tdoor[href="/team"]'))
    .toHaveAttribute("aria-label", "Open your roster");
});

/**
 * Every board that draws a team draws a door to its roster, not just the
 * standings — the complaint this answers was that clicking a team on the
 * Sunday board did nothing at all.
 *
 * One test over several fixtures rather than one per page: the thing worth
 * pinning down is that the rule is league-wide, and the rule is one helper.
 */
test("every board opens a team's roster", async ({ page }) => {
  // The scoreboard: both sides of every card, crest and record inside the door.
  // Three games in the fixture, so six sides — one of them the reader's own,
  // which goes to plain `/team`.
  await page.goto("/preview/matchups");
  const sides = page.locator("a.sb__who[href^='/team']");
  await expect(sides).toHaveCount(6);
  await expect(sides.first().locator(".seal")).toHaveCount(1);
  await expect(page.locator("a.sb__who[href='/team']")).toHaveCount(1);

  // The power rankings, beneath the table that disagrees with them.
  await page.goto("/preview/standings");
  await expect(page.locator(".pwr a[href^='/team']")).toHaveCount(12);

  // The clubhouse scoreline — both sides of tonight's game. The six tables in
  // the carousel under it are each one link to the full scoreboard already, so
  // they hold no door of their own; the board they open is full of them.
  await page.goto("/preview/tonight");
  await expect(page.locator("a.tt__who[href^='/team']")).toHaveCount(2);
  await expect(page.locator("a.table__name")).toHaveCount(0);

  // Sunday Live's featured game, both sides of it.
  await page.goto("/preview/sunday");
  await expect(page.locator("a.sun-team__id[href^='/team']")).toHaveCount(2);
});

/**
 * A door with nowhere to go is still drawn, and is still inert.
 *
 * The clubhouse's scoreline doubles as the draft clock and the countdown to the
 * doors, and those sides are a number with a caption rather than a team. They
 * keep the block that lays them out — otherwise the bar reflows on a Tuesday —
 * so the anchor is there with no `href` on it.
 */
test("a side that is not a team is not a door", async ({ page }) => {
  await page.goto("/preview/tonight");
  for (const el of await page.locator("a.tt__who").all()) {
    const href = await el.getAttribute("href");
    if (href !== null) expect(href).toMatch(/^\/team/);
  }
});

/**
 * The trade desk names teams in three places, and every one of them is a door
 * built from an id the offer payload already carried — `proposer_team_id` and
 * `receiver_team_id`, never the name it prints.
 *
 * Which end of the offer gets named depends on which way it went, so the test
 * checks the id as well as the count: a door that opened the wrong side of a
 * trade would still look right.
 */
test("the trade desk opens the team across the table", async ({ page }) => {
  await page.goto("/preview/trades");

  // The live offer in the fixture came FROM t2 to the reader, so the header
  // names the proposer, not the reader.
  await expect(page.getByRole("link", { name: "Open Prime Cut's roster" }).first())
    .toHaveAttribute("href", "/team?id=t2");

  // The block: a listing of the reader's own goes to plain /team, somebody
  // else's to their desk.
  const block = page.locator(".row", { hasText: "want a back" });
  await expect(block.locator("a[href='/team?id=t2']")).toHaveCount(1);

  // Settled offers the reader sent name the receiver.
  await expect(page.locator("a[href='/team?id=t8']")).toHaveCount(1);
  await expect(page.locator("a[href='/team?id=t12']")).toHaveCount(1);
});

/**
 * The ledger is the one screen with no team ids to link by — `ff_transactions`
 * records each side of a move as a name, because the row is read as a sentence.
 * So the names are resolved against the league's own team list.
 *
 * The fixture's list deliberately omits one of the teams in the week, which is
 * what a team renamed since the move looks like. That name has to stay plain
 * text: a door built on a near-miss would open a roster that had nothing to do
 * with the move being read.
 */
test("the ledger opens the teams it can place, and only those", async ({ page }) => {
  await page.goto("/preview/ledger");

  // Scoped to the entries: every team in the week is also an <option> in the
  // filter above them, and an option is not a door however it reads.
  const rows = page.locator(".rows");

  // Placed: Chuck Wagon is the reader (plain /team), the Butchers are visited.
  await expect(rows.locator("a[href='/team?id=t1']").first()).toBeVisible();
  await expect(rows.locator("a[href='/team']").first()).toBeVisible();

  // Not placed: Brisket Brigade is absent from the fixture's league, so it is
  // named without being linked — and still rendered.
  await expect(rows.getByText("Brisket Brigade").first()).toBeVisible();
  await expect(rows.getByRole("link", { name: /Brisket Brigade/ })).toHaveCount(0);
});

/**
 * The waiver order is the wire's one list of other teams, and `ff_waiver_board`
 * gives it as names and priorities — so it resolves the same way the ledger
 * does, with the same two misses.
 *
 * The row already knew which one was the reader's, for the "you" marker. The
 * door reads that same answer: a row badged "you" whose link opened somebody
 * else's desk would be the two of them disagreeing in public, so the test
 * asserts they agree.
 */
test("the waiver order opens the teams ahead of you", async ({ page }) => {
  await page.goto("/preview/waivers");
  const order = page.locator(".card", { hasText: "Waiver order" }).locator(".rows");

  // Four of the five are in the fixture's league: three visits and the reader.
  await expect(order.locator("a[href^='/team?id=']")).toHaveCount(3);

  // The row marked "you" is the one that goes home, not to a ?id=.
  const you = order.locator(".row", { hasText: "you" });
  await expect(you.locator("a[href='/team']")).toHaveCount(1);
  await expect(you).toContainText("Gridiron Butchers");

  // And the one the league list cannot place is named without being linked.
  await expect(order.getByText("Brisket Brigade")).toBeVisible();
  await expect(order.getByRole("link", { name: /Brisket Brigade/ })).toHaveCount(0);
});
