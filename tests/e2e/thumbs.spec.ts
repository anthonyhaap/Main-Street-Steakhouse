import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Game day under a thumb.
 *
 * Sunday is read on a phone held in one hand, and on a touch screen every
 * game-day control gets a target near the 44px the tab bar takes: buttons by
 * growing, text links by a hit area wider than the words (sunday.css,
 * "thumbs"). What is measured here is what a finger meets — the run of points
 * through the control's centre that land on it — not the box it draws, which
 * for a text link is deliberately smaller.
 */

test.skip(({ isMobile }) => !isMobile, "touch targets are a phone's question");

async function reach(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((el) => {
    document.documentElement.style.scrollBehavior = "auto";
    const r = el.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.top - innerHeight / 2);
    const c = el.getBoundingClientRect();
    const x = c.left + c.width / 2, y = c.top + c.height / 2;
    const on = (px: number, py: number) => { const t = document.elementFromPoint(px, py); return !!t && (t === el || el.contains(t)); };
    let tall = 0, wide = 0;
    for (let d = -40; d <= 40; d++) { if (on(x, y + d)) tall++; if (on(x + d, y)) wide++; }
    return { tall, wide };
  });
}

const BIG = 36;

test("the game center's controls are big enough for a thumb", async ({ page }) => {
  await page.goto("/preview/sunday");
  await page.getByRole("button", { name: "Late window", exact: true }).click();
  for (const [what, target] of [
    ["a table chip", page.locator(".sun-pick:visible button").first()],
    ["a feed card's action", page.locator(".sun-alert__act button:visible").first()],
    ["a reaction", page.locator(".sun-react__btn:visible").first()],
    ["Talk shit", page.locator(".sun-talk:visible").first()],
    ["the push offer's Not now", page.locator(".gd-push .sun-linkbtn")],
  ] as const) {
    const { tall, wide } = await reach(page, target);
    expect(tall, `${what}: tall`).toBeGreaterThanOrEqual(BIG);
    expect(wide, `${what}: wide`).toBeGreaterThanOrEqual(BIG);
  }
});

test("the front page's game-day links reach past their words", async ({ page }) => {
  await page.goto("/preview/tonight");
  await page.getByRole("button", { name: "Sunday live", exact: true }).click();
  for (const target of [page.locator(".room__head a.eyebrow").first(), page.locator(".club__read")]) {
    expect((await reach(page, target)).tall).toBeGreaterThanOrEqual(BIG);
  }
});

test("the recap's results and reactions take a thumb", async ({ page }) => {
  await page.goto("/preview/recap");
  for (const target of [page.locator(".recap__result").first(), page.locator(".recap__foot .reaction").first()]) {
    expect((await reach(page, target)).tall).toBeGreaterThanOrEqual(BIG - 2);
  }
});

test("a bigger reach never takes a tap from the control next to it", async ({ page }) => {
  for (const [path, stage] of [["/preview/sunday", "Late window"], ["/preview/sunday", "Tuesday"],
    ["/preview/tonight", "Sunday live"], ["/preview/recap", null], ["/preview/matchup", "Late window"]] as const) {
    await page.goto(path);
    if (stage) await page.getByRole("button", { name: stage, exact: true }).first().click();
    const stolen = await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const out: string[] = [];
      const controls = [...document.querySelectorAll<HTMLElement>("a[href], button, summary")]
        .filter((el) => !el.closest(".sun-ticker__stage, main > .card:first-child, nextjs-portal"));
      for (const el of controls) {
        const r0 = el.getBoundingClientRect();
        if (r0.width < 4 || r0.height < 4 || getComputedStyle(el).visibility === "hidden") continue;
        window.scrollTo(0, window.scrollY + r0.top - innerHeight / 2);
        const r = el.getBoundingClientRect();
        if (r.left < 0 || r.right > innerWidth) continue; // off to the side in a scroller
        for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.15, 0.5, 0.85]) {
          const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
          const other = t?.closest("a[href], button, summary");
          if (other && other !== el && !el.contains(other) && !other.contains(el)) {
            out.push(`${(el.textContent ?? "").trim().slice(0, 30)} ← ${(other.textContent ?? "").trim().slice(0, 30)}`);
            break;
          }
        }
      }
      return [...new Set(out)];
    });
    expect(stolen, `${path} ${stage ?? ""}`).toEqual([]);
  }
});
