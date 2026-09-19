import { expect, test } from "@playwright/test";

/**
 * Proportion.
 *
 * Every screen sets its type from the --t-* scale and its badges from one
 * family, and this is the file that keeps it so. The assertions are geometry
 * rather than sentences: nothing a manager reads is smaller than nine pixels,
 * nothing pushes the page sideways on a phone, and a badge is one of two
 * sizes rather than whatever the last component decided.
 *
 * It runs against the /preview/* fixtures because they need no session and
 * hold still. Both projects run it; the mobile one is the point.
 */

const PAGES = [
  "/preview/tonight", "/preview/standings", "/preview/team", "/preview/draft", "/preview/history",
  "/preview/chat", "/preview/league-feed", "/preview/matchups", "/preview/players", "/preview/trades", "/preview/waivers",
  "/preview/ledger", "/preview/notifications", "/preview/challenges",
];

/* Drawn objects are exempt: the doors' SVG lettering, the draft TV, the
   wordmark, and anything hidden from assistive tech — a crest's fallback
   monogram in the corner of a headshot is a picture, not a word. Everything
   else is read. */
const DRAWN = ".doors, .tv, .mark__words, svg, [aria-hidden='true']";

test.describe("proportion", () => {
  for (const path of PAGES) {
    test(`${path} fits the screen and keeps the floor`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const width = page.viewportSize()!.width;
      const doc = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(doc, `${testInfo.project.name}: ${path} scrolls sideways`).toBeLessThanOrEqual(width);

      // No element outside a deliberate scroller reaches past the viewport.
      const spill = await page.evaluate((w) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          if (el.closest(".scroll, .segmented, .h2h, .carousel, .modal, .toasts, .ticker, [aria-hidden='true']")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.right > w + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} right=${Math.round(r.right)}`);
          if (out.length > 5) break;
        }
        return out;
      }, width);
      expect(spill, `${testInfo.project.name}: ${path} has elements past the edge`).toEqual([]);

      // The floor: text is nine pixels or larger, always.
      const small = await page.evaluate((drawn) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          if (el.closest(drawn)) continue;
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
          if (!hasText) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 9) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${size}px`);
          if (out.length > 5) break;
        }
        return out;
      }, DRAWN);
      expect(small, `${testInfo.project.name}: ${path} sets text below nine pixels`).toEqual([]);

      expect(errors).toEqual([]);
    });
  }

  test("badges are one family", async ({ page }) => {
    for (const path of ["/preview/team", "/preview/draft", "/preview/tonight", "/preview/challenges"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const sizes = await page.evaluate(() => {
        const seen = new Set<string>();
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".badge, .pos"))) {
          const cs = getComputedStyle(el);
          if (cs.display === "none") continue;
          seen.add(`${el.dataset.size === "sm" ? "sm" : "std"}:${cs.fontSize}`);
        }
        return Array.from(seen).sort();
      });
      // A small badge is nine pixels; a standard one is eleven. Nothing else.
      for (const s of sizes) {
        expect(s === "sm:9px" || s === "std:11px", `${path}: ${s}`).toBe(true);
      }
    }
  });

  test("the tab bar's labels are whole", async ({ page }) => {
    await page.goto("/preview/tonight");
    const bar = page.locator(".tabbar");
    if (!(await bar.isVisible())) return;   // the desktop project has a nav instead
    const clipped = await bar.locator(".tabbar__item > span").evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
    expect(clipped).toEqual([]);
  });
});
