import { expect, test, type Page } from "@playwright/test";

/**
 * Power rankings — the table with the schedule taken out.
 *
 * The fixture at /preview/standings is a seeded league, so the numbers are
 * fixed without being hand-written. Most of what is asserted here is an
 * invariant rather than a constant: an all-play record has an exact number of
 * results in it, every result is somebody else's opposite result, and the
 * order on screen has to follow from the two records printed in the row. Those
 * hold whatever the seed does, and they are the things that would actually be
 * wrong if the maths were wrong.
 */

type Row = { rank: number; name: string; ap: [number, number]; last: [number, number] };

async function rows(page: Page): Promise<Row[]> {
  return page.locator(".pwr__row").evaluateAll((els) =>
    els.map((el) => {
      const nums = [...el.querySelectorAll(".pwr__num b")].map((b) => b.textContent ?? "");
      const pair = (s: string): [number, number] => {
        const [w, l] = s.split("-").map(Number);
        return [w, l];
      };
      return {
        rank: Number(el.querySelector(".pwr__rank")?.textContent ?? 0),
        name: (el.querySelector(".pwr__name")?.childNodes[0]?.textContent ?? "").trim(),
        ap: pair(nums[0] ?? ""),
        last: pair(nums[1] ?? ""),
      };
    }),
  );
}

test("every team is scored against the whole league, every week", async ({ page }) => {
  await page.goto("/preview/standings");
  const all = await rows(page);

  expect(all).toHaveLength(12);
  expect(all.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  // Ten played weeks against eleven opponents is a hundred and ten results,
  // for everybody. A team short of that has been compared against a week it
  // did not play, or missed one it did.
  for (const r of all) {
    expect(r.ap[0] + r.ap[1], `${r.name} all-play`).toBe(110);
    expect(r.last[0] + r.last[1], `${r.name} last three`).toBe(33);
  }
});

test("every all-play win is somebody else's loss", async ({ page }) => {
  await page.goto("/preview/standings");
  const all = await rows(page);

  // Twelve teams make sixty-six pairs a week, and ten weeks of those is six
  // hundred and sixty results counted from each side. If the two totals
  // disagree, a comparison has been counted once or three times.
  const wins = all.reduce((s, r) => s + r.ap[0], 0);
  const losses = all.reduce((s, r) => s + r.ap[1], 0);
  expect(wins).toBe(losses);
  expect(wins).toBe(660);
});

test("the order follows from the two records printed in the row", async ({ page }) => {
  await page.goto("/preview/standings");
  const all = await rows(page);

  // The card says it weights the season 65% and the last three weeks 35%.
  // A ranking whose order cannot be reproduced from the numbers beside it is
  // asking to be trusted, which is not the same as being checkable — and it
  // is what a reader calls a bug when row five shows a better record than
  // row four.
  const score = (r: Row) =>
    0.65 * (r.ap[0] / (r.ap[0] + r.ap[1])) + 0.35 * (r.last[0] / (r.last[0] + r.last[1]));

  for (let i = 1; i < all.length; i++) {
    expect(score(all[i - 1]), `${all[i - 1].name} over ${all[i].name}`)
      .toBeGreaterThanOrEqual(score(all[i]) - 1e-9);
  }

  // And the case that made this worth asserting: somebody ranked below a team
  // with a worse season record, on form.
  const onForm = all.find((r, i) => i > 0 && r.ap[0] > all[i - 1].ap[0]);
  expect(onForm, "the fixture should contain at least one team held back by form").toBeTruthy();
});

test("the headline names the gap between the table and the scores", async ({ page }) => {
  await page.goto("/preview/standings");

  // Marcus is top of the table on a seventh-best all-play. That is the
  // argument the rankings exist to start, so it is stated rather than left to
  // be found by reading twelve rows.
  await expect(page.locator(".pwr__headline"))
    .toHaveText("Marcus is 1st in the table and 3rd here. The schedule has been kind.");
  await expect(page.getByText("Marcus is 2 wins better off than he has played.")).toBeVisible();
});

test("a row says where the same team sits in the table above it", async ({ page }) => {
  await page.goto("/preview/standings");

  const top = page.locator(".pwr__row").first();
  await expect(top.locator(".pwr__pos")).toHaveText("4th in the table");
});

test("movement is stated in words, not only in colour", async ({ page }) => {
  await page.goto("/preview/standings");

  await expect(page.getByLabel("Up 4 places")).toBeVisible();
  await expect(page.getByLabel("Down 3 places")).toBeVisible();
  await expect(page.getByText("Down 3 places on last week.")).toBeVisible();
});

test("nothing played means no ranking, and it says why", async ({ page }) => {
  await page.goto("/preview/standings");
  await page.getByRole("button", { name: "Before the draft" }).click();

  await expect(page.locator(".pwr__row")).toHaveCount(0);
  await expect(page.getByText(/The rankings score every team against the whole league each week/))
    .toBeVisible();
});

test("your own row is marked", async ({ page }) => {
  await page.goto("/preview/standings");
  const mine = page.locator('.pwr__row[data-mine="true"]');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("The Porterhouse");
});
